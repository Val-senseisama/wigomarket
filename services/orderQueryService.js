const Order = require("../models/orderModel");
const User = require("../models/userModel");
const { DeliveryMethod } = require("../utils/constants");
const {
  STATUS,
  ALL_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  parseStatus,
  statusMatchValues,
  CATEGORY,
  parseCategory,
  categoryFilter,
} = require("../utils/orderStatus");
const { serializeOrderSummary, serializeOrderDetail } = require("../utils/orderSerializer");

/** A client-supplied query value the list cannot honour — surfaced as a 400. */
class OrderQueryError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderQueryError";
    this.statusCode = 400;
  }
}

// Map the UI "Order Type" dropdown to a deliveryMethod query.
const orderTypeFilter = (orderType) => {
  if (!orderType) return {};
  const value = String(orderType).toLowerCase();
  if (value === "pick up" || value === "pickup" || value === DeliveryMethod.SELF_DELIVERY) {
    return { deliveryMethod: DeliveryMethod.SELF_DELIVERY };
  }
  if (value === "delivery" || value === DeliveryMethod.DELIVERY_AGENT) {
    return { deliveryMethod: DeliveryMethod.DELIVERY_AGENT };
  }
  return {};
};

// Filter by one or more statuses, for the UI's multi-select. Accepts every
// shape a multi-select can arrive in:
//   ?status=pending&status=confirmed      (repeated key → array)
//   ?status[]=pending&status[]=confirmed
//   ?status=pending,confirmed             (comma-separated)
// Each value may be a canonical token, a display label or a legacy value.
// Selected statuses are OR-ed together, then AND-ed with the other filters.
const statusFilter = (status) => {
  if (status == null || status === "") return {};
  const values = (Array.isArray(status) ? status : [status])
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  if (!values.length) return {};

  const unknown = values.filter((v) => !parseStatus(v));
  if (unknown.length) {
    throw new OrderQueryError(
      `Invalid status: ${unknown.join(", ")}. Must be one of: ${ALL_STATUSES.join(", ")}`,
    );
  }

  const canonical = [...new Set(values.map(parseStatus))];
  // statusMatchValues folds in legacy spellings still stored on old documents.
  return { orderStatus: { $in: canonical.flatMap(statusMatchValues) } };
};

// Inclusive date range on createdAt.
const dateFilter = (dateFrom, dateTo) => {
  const range = {};
  if (dateFrom) {
    const from = new Date(dateFrom);
    if (!isNaN(from)) range.$gte = from;
  }
  if (dateTo) {
    const to = new Date(dateTo);
    if (!isNaN(to)) range.$lte = to;
  }
  return Object.keys(range).length ? { createdAt: range } : {};
};

// Search by order number OR customer name (resolved via the User collection).
const searchFilter = async (search) => {
  if (!search) return {};
  const rx = { $regex: search.trim().replace(/^#/, ""), $options: "i" };

  const users = await User.find(
    { $or: [{ fullName: rx }, { firstname: rx }, { lastname: rx }] },
    "_id",
  ).lean();

  const or = [{ orderNumber: rx }];
  if (users.length) or.push({ orderedBy: { $in: users.map((u) => u._id) } });
  return { $or: or };
};

const SORTABLE = { date: "createdAt", amount: "paymentIntent.amount" };

const buildSort = (sortBy, sortOrder) => {
  const field = SORTABLE[String(sortBy || "").toLowerCase()] || "createdAt";
  const direction = String(sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { [field]: direction };
};

const scopedCount = (baseFilter, fragment) => {
  const parts = [baseFilter, fragment].filter((f) => f && Object.keys(f).length);
  return Order.countDocuments(parts.length ? { $and: parts } : {});
};

/**
 * List orders for a dashboard table.
 *
 * @param {Object} opts
 * @param {Object} [opts.baseFilter={}] Scope filter (e.g. seller's store) applied to every query.
 * @param {Object} opts.query           Raw req.query: category (all|pending|ongoing|history,
 *                                       "recent" = all), status (one or many), orderType,
 *                                       dateFrom, dateTo, search, sortBy, sortOrder, page, limit.
 * @param {string} [opts.role]          Viewer role; when given each row carries allowedActions.
 * @returns {Promise<{orders: Object[], pagination: Object, counts: Object}>}
 * @throws {OrderQueryError} On an unknown category or status.
 */
const listOrders = async ({ baseFilter = {}, query = {}, role }) => {
  const category = parseCategory(query.category);
  if (!category) {
    throw new OrderQueryError(
      `Invalid category: ${query.category}. Must be one of: ${Object.values(CATEGORY).join(", ")}`,
    );
  }

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const fragments = [
    baseFilter,
    categoryFilter(category),
    statusFilter(query.status),
    orderTypeFilter(query.orderType),
    dateFilter(query.dateFrom, query.dateTo),
    await searchFilter(query.search),
  ].filter((f) => f && Object.keys(f).length);

  const filter = fragments.length ? { $and: fragments } : {};

  const [orders, total, all, pending, ongoing, history] = await Promise.all([
    Order.find(filter)
      .populate("orderedBy", "fullName firstname lastname email mobile")
      .sort(buildSort(query.sortBy, query.sortOrder))
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
    // Tab counts are scoped to baseFilter only so each tab shows its true total.
    // Keys match the `category` values: all = ongoing + history, and pending
    // (not yet confirmed) is a subset of ongoing.
    scopedCount(baseFilter, {}),
    scopedCount(baseFilter, { orderStatus: STATUS.PENDING }),
    scopedCount(baseFilter, { orderStatus: { $in: ACTIVE_STATUSES } }),
    scopedCount(baseFilter, { orderStatus: { $in: TERMINAL_STATUSES } }),
  ]);

  return {
    orders: orders.map((order) => serializeOrderSummary(order, { role })),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: skip + orders.length < total,
    },
    counts: { all, pending, ongoing, history },
  };
};

/**
 * Fetch a single order, fully populated and serialized for the detail screen.
 *
 * @param {string} orderId
 * @param {Object} [baseFilter={}] Scope filter (e.g. seller's store) merged into the lookup.
 * @returns {Promise<Object|null>} Serialized order detail, or null if not found / out of scope.
 */
const getOrderDetail = async (orderId, baseFilter = {}, options = {}) => {
  const order = await Order.findOne({ _id: orderId, ...baseFilter })
    .populate("products.product", "title listedPrice price images brand")
    .populate("orderedBy", "fullName firstname lastname email mobile")
    .populate("deliveryAgent", "fullName firstname lastname mobile")
    .lean();

  return order ? serializeOrderDetail(order, options) : null;
};

module.exports = { listOrders, getOrderDetail, CATEGORY, OrderQueryError };
