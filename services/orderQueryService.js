const Order = require("../models/orderModel");
const User = require("../models/userModel");
const { DeliveryMethod } = require("../utils/constants");
const {
  STATUS,
  ALL_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  normalizeStatus,
  CATEGORY,
  categoryFilter,
} = require("../utils/orderStatus");
const { serializeOrderSummary, serializeOrderDetail } = require("../utils/orderSerializer");

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

// Filter by a specific canonical status. Accepts a token (e.g. "pickUpReady")
// or a legacy value, normalising either to a canonical state.
const statusFilter = (status) => {
  if (!status) return {};
  const normalized = normalizeStatus(status);
  return ALL_STATUSES.includes(normalized) ? { orderStatus: normalized } : {};
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
 * @param {Object} opts.query           Raw req.query: category (all|pending|ongoing|history),
 *                                       status, orderType, dateFrom, dateTo, search, sortBy,
 *                                       sortOrder, page, limit.
 * @returns {Promise<{orders: Object[], pagination: Object, counts: Object}>}
 */
const listOrders = async ({ baseFilter = {}, query = {} }) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const fragments = [
    baseFilter,
    categoryFilter(query.category),
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
    scopedCount(baseFilter, {}),
    scopedCount(baseFilter, { orderStatus: STATUS.PENDING }),
    scopedCount(baseFilter, { orderStatus: { $in: ACTIVE_STATUSES } }),
    scopedCount(baseFilter, { orderStatus: { $in: TERMINAL_STATUSES } }),
  ]);

  return {
    orders: orders.map(serializeOrderSummary),
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
const getOrderDetail = async (orderId, baseFilter = {}) => {
  const order = await Order.findOne({ _id: orderId, ...baseFilter })
    .populate("products.product", "title listedPrice price images brand")
    .populate("orderedBy", "fullName firstname lastname email mobile")
    .populate("deliveryAgent", "fullName firstname lastname mobile")
    .lean();

  return order ? serializeOrderDetail(order) : null;
};

module.exports = { listOrders, getOrderDetail, CATEGORY };
