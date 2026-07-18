const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Order = require("../../models/orderModel");
const User = require("../../models/userModel");
const Store = require("../../models/storeModel");
const { itemsCount, formatOrderNumber } = require("../../utils/orderSerializer");

// Treat user input as a literal, not as a regex the caller controls
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The date a row is shown/filtered/sorted by. Delivered orders use the actual
// delivery time; cancelled ones never have one, so they fall back to createdAt.
const ROW_DATE = { $ifNull: ["$actualDeliveryTime", "$createdAt"] };

/**
 * @function getEarningsHistory
 * @description Paginated, table-friendly history of the deliveries that earned
 *              the agent money. Each row carries exactly what the earnings table
 *              renders (date/time, customer, route, amount, status) instead of a
 *              raw order document. Supports an optional date range.
 *
 * @param {string}  req.user._id        - Authenticated agent's ID
 * @param {number} [req.query.page=1]   - Page number
 * @param {number} [req.query.limit=10] - Items per page (max 100)
 * @param {string} [req.query.startDate]- ISO date — earliest delivery to include
 * @param {string} [req.query.endDate]  - ISO date — latest delivery to include
 * @param {string} [req.query.search]   - Free text: order id, reference, customer
 *                                        name/mobile, store, address, or a
 *                                        YYYY-MM-DD / YYYY-MM date
 * @param {number} [req.query.month]    - 1-12, filters to that month
 * @param {number} [req.query.year]     - e.g. 2026, filters to that year
 * @returns {Object} - { orders: row[], summary, pagination }
 *
 * All filters combine with AND, and the summary totals always reflect the same
 * filtered set as the rows (not just the current page).
 */
const getEarningsHistory = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const skip = (page - 1) * limit;
  const { startDate, endDate, search } = req.query;
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  const status = (req.query.status || "delivered").toLowerCase();

  const ALLOWED_STATUSES = ["delivered", "cancelled", "all"];
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Expected one of: ${ALLOWED_STATUSES.join(", ")}.`,
    });
  }

  if (month !== null && (Number.isNaN(month) || month < 1 || month > 12)) {
    return res.status(400).json({
      success: false,
      message: "Invalid month. Expected 1-12.",
    });
  }
  if (year !== null && (Number.isNaN(year) || year < 2000 || year > 2100)) {
    return res.status(400).json({
      success: false,
      message: "Invalid year.",
    });
  }

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view earnings history.",
    });
  }

  // Rows the table shows. "cancelled" is an order-level state (orderStatus),
  // not a deliveryStatus — a cancelled order never reaches deliveryStatus
  // "delivered", so the two sets are disjoint.
  const DELIVERED = { deliveryStatus: "delivered", orderStatus: { $ne: "cancelled" } };
  const CANCELLED = { orderStatus: "cancelled" };

  const query = { deliveryAgent: _id };
  if (status === "delivered") Object.assign(query, DELIVERED);
  else if (status === "cancelled") Object.assign(query, CANCELLED);
  else query.$and = [{ $or: [DELIVERED, CANCELLED] }];

  // Collect lower/upper bounds from both sources, then keep the tightest of
  // each so month/year and an explicit range narrow rather than clobber.
  let gte = null;
  let lte = null;

  if (startDate) gte = new Date(startDate);
  if (endDate) {
    // Make endDate inclusive of the whole day when a bare date is supplied
    const end = new Date(endDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) {
      end.setHours(23, 59, 59, 999);
    }
    lte = end;
  }

  // Dropdown filter: month + year, or either on its own. Month without a year
  // means that month of the current year. Bounds are UTC, matching the UTC
  // date/time strings each row renders with.
  if (month !== null || year !== null) {
    const effectiveYear = year !== null ? year : new Date().getUTCFullYear();
    const periodStart =
      month !== null
        ? new Date(Date.UTC(effectiveYear, month - 1, 1, 0, 0, 0, 0))
        : new Date(Date.UTC(effectiveYear, 0, 1, 0, 0, 0, 0));
    const periodEnd =
      month !== null
        ? new Date(Date.UTC(effectiveYear, month, 0, 23, 59, 59, 999))
        : new Date(Date.UTC(effectiveYear, 11, 31, 23, 59, 59, 999));

    if (!gte || periodStart > gte) gte = periodStart;
    if (!lte || periodEnd < lte) lte = periodEnd;
  }

  if (gte || lte) {
    if (status === "delivered") {
      // Indexed path for the common case
      query.actualDeliveryTime = {};
      if (gte) query.actualDeliveryTime.$gte = gte;
      if (lte) query.actualDeliveryTime.$lte = lte;
    } else {
      // Cancelled orders never get an actualDeliveryTime, so filtering on it
      // alone would silently drop every cancelled row. Fall back to createdAt.
      const bounds = [];
      if (gte) bounds.push({ $gte: [ROW_DATE, gte] });
      if (lte) bounds.push({ $lte: [ROW_DATE, lte] });
      query.$expr = bounds.length > 1 ? { $and: bounds } : bounds[0];
    }
  }

  // Free-text search across the columns the table renders. Customer and store
  // live on other collections, so resolve those to ids first and match by id.
  const term = typeof search === "string" ? search.trim() : "";
  if (term) {
    const rx = new RegExp(escapeRegex(term), "i");

    const [matchingUsers, matchingStores] = await Promise.all([
      User.find({
        $or: [
          { fullName: rx },
          { firstname: rx },
          { lastname: rx },
          { mobile: rx },
        ],
      })
        .select("_id")
        .lean(),
      Store.find({ name: rx }).select("_id").lean(),
    ]);

    const or = [{ clientSideId: rx }, { deliveryAddress: rx }];

    if (mongoose.Types.ObjectId.isValid(term)) {
      or.push({ _id: new mongoose.Types.ObjectId(term) });
    }
    if (matchingUsers.length) {
      or.push({ orderedBy: { $in: matchingUsers.map((u) => u._id) } });
    }
    if (matchingStores.length) {
      or.push({ "products.store": { $in: matchingStores.map((s) => s._id) } });
    }

    // A typed date (YYYY-MM-DD or YYYY-MM) matches that whole day / month
    const ymd = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(term);
    if (ymd) {
      const y = Number(ymd[1]);
      const m = Number(ymd[2]);
      const d = ymd[3] ? Number(ymd[3]) : null;
      if (m >= 1 && m <= 12) {
        const from = d
          ? new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
          : new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
        const to = d
          ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
          : new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
        or.push({ actualDeliveryTime: { $gte: from, $lte: to } });
      }
    }

    query.$or = or;
  }

  // Money is only ever earned on a delivered order, so the totals ignore the
  // status filter entirely — a cancelled row is shown but earns nothing.
  const earningsQuery = { ...query, ...DELIVERED };
  delete earningsQuery.$and; // drop the row-level status disjunction

  try {
    const [orders, total, rangeTotals] = await Promise.all([
      Order.find(query)
        .populate("orderedBy", "firstname lastname fullName mobile")
        .populate("products.store", "name address")
        // Cancelled rows have no actualDeliveryTime and would all sink to the
        // bottom, so mixed views order by when the order was placed instead.
        .sort(status === "delivered" ? { actualDeliveryTime: -1 } : { createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
      Order.aggregate([
        { $match: { ...earningsQuery, deliveryAgent: _id } },
        {
          $group: {
            _id: null,
            totalEarnings: { $sum: "$deliveryFee" },
            totalDeliveries: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Shape each order into a single earnings-table row
    const rows = orders.map((order) => {
      const customer = order.orderedBy
        ? order.orderedBy.fullName ||
          [order.orderedBy.firstname, order.orderedBy.lastname]
            .filter(Boolean)
            .join(" ") ||
          null
        : null;
      const pickupStore = order.products?.[0]?.store;
      const deliveredAt = order.actualDeliveryTime || null;
      const lines = order.products || [];
      const isCancelled = order.orderStatus === "cancelled";
      // Same fallback the query uses, so the column matches what was filtered
      const rowDate = deliveredAt || order.createdAt || null;

      return {
        orderId: order._id,
        reference: order.clientSideId || String(order._id),
        date: rowDate ? new Date(rowDate).toISOString().split("T")[0] : null,
        time: rowDate
          ? new Date(rowDate).toISOString().split("T")[1].slice(0, 5)
          : null,
        deliveredAt,
        customer,
        customerMobile: order.orderedBy?.mobile || null,
        orderNumber: formatOrderNumber(order),
        itemCount: itemsCount(order),
        lineItemCount: lines.length,
        pickup: pickupStore?.name || pickupStore?.address || null,
        dropoff: order.deliveryAddress || null,
        // A cancelled order earns nothing, whatever fee was quoted on it
        deliveryFee: isCancelled ? 0 : order.deliveryFee || 0,
        amount: isCancelled ? 0 : order.deliveryFee || 0,
        // What the Status column renders: "cancelled" | "delivered"
        status: isCancelled ? "cancelled" : order.deliveryStatus,
        deliveryStatus: order.deliveryStatus,
        orderStatus: order.orderStatus,
      };
    });

    res.json({
      success: true,
      data: {
        orders: rows,
        summary: {
          totalEarnings: rangeTotals[0]?.totalEarnings || 0,
          totalDeliveries: rangeTotals[0]?.totalDeliveries || 0,
          range: {
            startDate: startDate || null,
            endDate: endDate || null,
            // Effective window actually applied, after month/year narrowing
            from: gte ? gte.toISOString() : null,
            to: lte ? lte.toISOString() : null,
          },
          filters: {
            search: term || null,
            month: month,
            year: year,
            status,
          },
        },
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: skip + orders.length < total,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "Failed to get earnings history");
  }
});

module.exports = getEarningsHistory;
