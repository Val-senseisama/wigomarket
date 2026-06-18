const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");

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
 * @returns {Object} - { orders: row[], summary, pagination }
 */
const getEarningsHistory = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const skip = (page - 1) * limit;
  const { startDate, endDate } = req.query;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view earnings history.",
    });
  }

  // Build query — only completed deliveries generate earnings
  const query = {
    deliveryAgent: _id,
    deliveryStatus: "delivered",
  };

  if (startDate || endDate) {
    query.actualDeliveryTime = {};
    if (startDate) query.actualDeliveryTime.$gte = new Date(startDate);
    if (endDate) {
      // Make endDate inclusive of the whole day when a bare date is supplied
      const end = new Date(endDate);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(endDate))) {
        end.setHours(23, 59, 59, 999);
      }
      query.actualDeliveryTime.$lte = end;
    }
  }

  try {
    const [orders, total, rangeTotals] = await Promise.all([
      Order.find(query)
        .populate("orderedBy", "firstname lastname fullName mobile")
        .populate("products.store", "name address")
        .sort({ actualDeliveryTime: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Order.countDocuments(query),
      Order.aggregate([
        { $match: { ...query, deliveryAgent: _id } },
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

      return {
        orderId: order._id,
        reference: order.clientSideId || String(order._id),
        date: deliveredAt ? new Date(deliveredAt).toISOString().split("T")[0] : null,
        time: deliveredAt
          ? new Date(deliveredAt).toISOString().split("T")[1].slice(0, 5)
          : null,
        deliveredAt,
        customer,
        customerMobile: order.orderedBy?.mobile || null,
        pickup: pickupStore?.name || pickupStore?.address || null,
        dropoff: order.deliveryAddress || null,
        amount: order.deliveryFee || 0,
        status: order.deliveryStatus,
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
