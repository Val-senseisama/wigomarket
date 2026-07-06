const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const DispatchProfile = require("../models/dispatchProfileModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");
const {
  sendPickedUpEmail,
  sendInTransitEmail,
  sendAgentAssignedEmail,
} = require("../services/dispatchEmailService");
const audit = require("../services/auditService");
const {
  transitionOrder,
  OrderTransitionError,
  ROLE,
  STATUS,
} = require("../services/orderTransitionService");
const {
  serializeDeliveryOrder,
  serializeDeliveryOrderList,
} = require("../utils/orderSerializer");

// Filter for the shared "available" pool: unassigned delivery-agent orders that
// any online rider can take. Not scoped to a single agent.
const AVAILABLE_POOL_FILTER = {
  deliveryMethod: "delivery_agent",
  deliveryStatus: "pending_assignment",
  deliveryAgent: { $exists: false },
  orderStatus: { $ne: "cancelled" },
};

// Base scope for a rider's own orders (any status).
const mineScope = (agentId) => ({
  deliveryAgent: agentId,
  deliveryMethod: "delivery_agent",
});

// Maps the rider app's Ongoing / Completed / Cancelled tabs onto the underlying
// deliveryStatus values. These are the status-only portions, combined with
// mineScope() at query time. The three buckets are kept mutually exclusive:
// "ongoing" excludes seller-cancelled orders so a cancelled order shows only in
// the Cancelled tab, never in both.
const TAB_FILTERS = {
  ongoing: {
    deliveryStatus: { $in: ["assigned", "picked_up", "in_transit"] },
    orderStatus: { $ne: "cancelled" },
  },
  completed: { deliveryStatus: "delivered" },
  cancelled: {
    $or: [{ deliveryStatus: "failed" }, { orderStatus: "cancelled" }],
  },
};

// Tabs supported by the unified feed endpoint (GET /orders). "all" unions the
// available pool with every order belonging to this rider; "available" is the
// shared pool; the rest are this rider's own orders by tab.
const buildFeedFilter = (tab, agentId) => {
  switch (tab) {
    case "available":
      return AVAILABLE_POOL_FILTER;
    case "ongoing":
    case "completed":
    case "cancelled":
      return { ...mineScope(agentId), ...TAB_FILTERS[tab] };
    case "all":
      return { $or: [AVAILABLE_POOL_FILTER, mineScope(agentId)] };
    default:
      return null;
  }
};

// Returns a specific rejection message if the agent can't act on orders yet, or
// null if the profile is approved & active. Distinguishes the "no profile",
// "pending approval", "rejected" and "suspended" cases so the rider app can show
// something more useful than "profile not found or not active".
const profileGateMessage = (profile) => {
  if (!profile) {
    return "Delivery agent profile not found. Please complete your onboarding.";
  }
  if (profile.status === "suspended") {
    return "Your delivery agent account is suspended. Please contact support.";
  }
  if (profile.status === "rejected") {
    return "Your delivery agent profile was rejected. Please update your documents and resubmit.";
  }
  if (!profile.isActive || profile.status !== "approved") {
    return "Your delivery agent profile is pending admin approval.";
  }
  return null;
};

// Standard population for rider order responses, consumed by serializeDeliveryOrder.
const populateDeliveryOrder = (query) =>
  query
    .populate("products.product", "title listedPrice images brand")
    .populate("products.store", "name address mobile location")
    .populate("orderedBy", "firstname lastname fullName email mobile");

// Escape user input before using it in a RegExp so a search like "a.b" isn't
// treated as a wildcard.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Restrict orders to a calendar month and/or year (the table's period dropdown).
 * - month (1-12) + year  → that month
 * - year only            → the whole year
 * - month only           → that month in the current year
 * Returns a { createdAt: {...} } fragment, or null if neither is provided/valid.
 */
const buildPeriodFilter = (month, year) => {
  const m = month != null && month !== "" ? parseInt(month, 10) : null;
  const y = year != null && year !== "" ? parseInt(year, 10) : null;
  if (m == null && y == null) return null;
  if (m != null && (isNaN(m) || m < 1 || m > 12)) return null;
  if (y != null && isNaN(y)) return null;

  const baseYear = y != null ? y : new Date().getUTCFullYear();
  let start;
  let end;
  if (m != null) {
    start = new Date(Date.UTC(baseYear, m - 1, 1));
    end = new Date(Date.UTC(baseYear, m, 1));
  } else {
    start = new Date(Date.UTC(baseYear, 0, 1));
    end = new Date(Date.UTC(baseYear + 1, 0, 1));
  }
  return { createdAt: { $gte: start, $lt: end } };
};

/**
 * Free-text search across the fields shown in the orders table: order number
 * (with or without the leading "#"), the raw order id, delivery address, and the
 * customer's name / phone / email. Because the customer lives on a referenced
 * User doc, we resolve matching users first and filter orders by their ids.
 * Returns an { $or: [...] } fragment, or null when the term is empty.
 */
const buildSearchFilter = async (search) => {
  const term = (search || "").trim();
  if (!term) return null;

  const rx = new RegExp(escapeRegex(term), "i");
  const or = [
    { orderNumber: new RegExp(escapeRegex(term.replace(/^#/, "")), "i") },
    { deliveryAddress: rx },
  ];

  if (mongoose.isValidObjectId(term)) {
    or.push({ _id: term });
  }

  const users = await User.find({
    $or: [
      { fullName: rx },
      { firstname: rx },
      { lastname: rx },
      { email: rx },
      { mobile: rx },
    ],
  })
    .select("_id")
    .limit(100);

  if (users.length) {
    or.push({ orderedBy: { $in: users.map((u) => u._id) } });
  }

  return { $or: or };
};

/**
 * Combine the tab filter with optional period + search fragments. Each fragment
 * may carry its own $or, so they are ANDed together (a single top-level $or key
 * can't hold them all).
 */
const combineFilters = (...fragments) => {
  const parts = fragments.filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0];
  return { $and: parts };
};

/**
 * @function getAvailableOrders
 * @description Get orders available for delivery agent assignment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @param {string} [req.query.status] - Filter by delivery status
 * @returns {Object} - Available orders for delivery
 */
const getAvailableOrders = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { page = 1, limit = 10, status } = req.query;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view available orders.",
    });
  }

  // Get delivery agent's profile
  const dispatchProfile = await DispatchProfile.findOne({ user: _id });
  const gate = profileGateMessage(dispatchProfile);
  if (gate) {
    return res.status(400).json({ success: false, message: gate });
  }

  // Build filter for available orders. Defaults to the shared unassigned pool;
  // an explicit ?status= narrows to that delivery status for this agent.
  let filters;
  if (!status || status === "pending_assignment") {
    filters = AVAILABLE_POOL_FILTER;
  } else {
    filters = {
      deliveryMethod: "delivery_agent",
      deliveryStatus: status,
      orderStatus: { $ne: "cancelled" },
      deliveryAgent: _id,
    };
  }

  try {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await populateDeliveryOrder(Order.find(filters))
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(filters);

    res.json({
      success: true,
      data: {
        orders: serializeDeliveryOrderList(orders),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalOrders: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

/**
 * @function selectOrder
 * @description Delivery agent selects an order for delivery
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {string} req.body.orderId - Order ID to select
 * @returns {Object} - Success message and order details
 */
const selectOrder = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { orderId } = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can select orders.",
    });
  }

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  validateMongodbId(orderId);

  try {
    // Get delivery agent's profile
    const dispatchProfile = await DispatchProfile.findOne({ user: _id });
    const gate = profileGateMessage(dispatchProfile);
    if (gate) {
      return res.status(400).json({ success: false, message: gate });
    }

    // Check if agent is available
    if (dispatchProfile.availability.status !== "online") {
      return res.status(400).json({
        success: false,
        message: "You must be online to select orders",
      });
    }

    // Find the order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if order is available for assignment
    if (order.deliveryMethod !== "delivery_agent") {
      return res.status(400).json({
        success: false,
        message: "This order is not for delivery agent",
      });
    }

    if (order.deliveryStatus !== "pending_assignment") {
      return res.status(400).json({
        success: false,
        message: "This order is no longer available for assignment",
      });
    }

    // Check if agent already has an active order
    const activeOrder = await Order.findOne({
      deliveryAgent: _id,
      deliveryStatus: { $in: ["assigned", "picked_up", "in_transit"] },
    });

    if (activeOrder) {
      return res.status(400).json({
        success: false,
        message:
          "You already have an active delivery. Complete it before selecting another.",
      });
    }

    // Assign order to delivery agent atomically with a status guard
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: orderId,
        deliveryMethod: "delivery_agent",
        deliveryStatus: "pending_assignment",
      },
      {
        $set: {
          deliveryAgent: _id,
          dispatch: _id, // keep legacy dispatch ref in sync (was set by /orders/take)
          deliveryStatus: "assigned",
          estimatedDeliveryTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
        },
      },
      { new: true },
    );

    if (!updatedOrder) {
      return res.status(400).json({
        success: false,
        message: "This order is no longer available for assignment",
      });
    }

    const populatedOrder = await populateDeliveryOrder(
      Order.findById(updatedOrder._id),
    );

    // Update delivery agent's status to busy (dot notation preserves workingDays etc.)
    await DispatchProfile.findOneAndUpdate(
      { user: _id },
      { "availability.status": "busy", lastActiveAt: new Date() },
    );

    // Notify the customer that an agent has been assigned — non-blocking.
    const agent = await User.findById(_id).select("fullName firstname lastname");
    sendAgentAssignedEmail(populatedOrder.orderedBy, agent, populatedOrder);

    audit.log({
      action: "dispatch.taken",
      actor: audit.actor(req),
      resource: { type: "order", id: orderId },
      changes: {
        before: { deliveryStatus: "pending_assignment" },
        after: { deliveryStatus: "assigned", deliveryAgent: _id },
      },
    });

    res.json({
      success: true,
      message: "Order selected successfully",
      data: {
        order: serializeDeliveryOrder(populatedOrder),
        estimatedDeliveryTime: populatedOrder.estimatedDeliveryTime,
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

/**
 * @function updateDeliveryStatus
 * @description Update delivery status of an assigned order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {string} req.body.orderId - Order ID to update
 * @param {string} req.body.status - New delivery status
 * @param {string} [req.body.notes] - Optional delivery notes
 * @returns {Object} - Updated order details
 */
const updateDeliveryStatus = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { orderId, status, notes } = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message:
        "Access denied. Only delivery agents can update delivery status.",
    });
  }

  if (!orderId || !status) {
    return res.status(400).json({
      success: false,
      message: "Order ID and status are required",
    });
  }

  // "delivered" is handled by the dual-confirm flow (POST /orders/confirm-delivery)
  const validStatuses = ["assigned", "picked_up", "in_transit", "failed"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid status. Must be one of: " +
        validStatuses.join(", ") +
        ". Use /orders/confirm-delivery to mark as delivered.",
    });
  }

  validateMongodbId(orderId);

  try {
    // Find the order
    const order = await Order.findOne({
      _id: orderId,
      deliveryAgent: _id,
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found or not assigned to you",
      });
    }

    // Going in transit advances the canonical lifecycle (pickUpReady → inTransit)
    // via the state machine. This also enforces ordering: the seller must have
    // marked the order pickUpReady before the rider can set it in transit.
    if (status === "in_transit") {
      try {
        await transitionOrder({
          orderId,
          toStatus: STATUS.IN_TRANSIT,
          role: ROLE.RIDER,
          req,
        });
      } catch (err) {
        if (err instanceof OrderTransitionError) {
          return res
            .status(err.statusCode)
            .json({ success: false, message: err.message });
        }
        throw err;
      }
    }

    const updateData = { deliveryStatus: status };
    if (notes) updateData.deliveryNotes = notes;

    const updatedOrder = await populateDeliveryOrder(
      Order.findByIdAndUpdate(orderId, updateData, { new: true }),
    );

    // Update agent availability
    const dispatchProfile = await DispatchProfile.findOne({ user: _id });
    if (dispatchProfile) {
      const newAvailability = status === "failed" ? "online" : "busy";
      await DispatchProfile.findOneAndUpdate(
        { user: _id },
        {
          "availability.status": newAvailability,
          lastActiveAt: new Date(),
        },
      );
    }

    audit.log({
      action: "delivery.status_updated",
      actor: audit.actor(req),
      resource: { type: "order", id: orderId },
      changes: {
        before: { deliveryStatus: order.deliveryStatus },
        after: { deliveryStatus: status },
      },
      metadata: { notes },
    });

    // Email customer — non-blocking
    const customer = updatedOrder.orderedBy;
    if (status === "picked_up") {
      sendPickedUpEmail(customer, updatedOrder);
    } else if (status === "in_transit") {
      sendInTransitEmail(customer, updatedOrder);
    }

    res.json({
      success: true,
      message: `Delivery status updated to ${status}`,
      data: serializeDeliveryOrder(updatedOrder),
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

/**
 * @function getMyDeliveries
 * @description Get the authenticated rider's own orders, optionally narrowed to
 *              one of the Ongoing / Completed / Cancelled UI tabs.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @param {string} [req.query.tab] - UI tab: ongoing | completed | cancelled
 * @param {string} [req.query.status] - Exact deliveryStatus filter (advanced; ignored if tab is set)
 * @returns {Object} - Delivery agent's orders
 */
const getMyDeliveries = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { page = 1, limit = 10, status, tab } = req.query;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view their deliveries.",
    });
  }

  if (tab && !TAB_FILTERS[tab]) {
    return res.status(400).json({
      success: false,
      message: `Invalid tab. Must be one of: ${Object.keys(TAB_FILTERS).join(", ")}`,
    });
  }

  // Base scope: only this rider's delivery-agent orders.
  const filters = {
    deliveryAgent: _id,
    deliveryMethod: "delivery_agent",
  };

  // A tab (UI) takes precedence over an exact status filter (advanced use).
  if (tab) {
    Object.assign(filters, TAB_FILTERS[tab]);
  } else if (status) {
    filters.deliveryStatus = status;
  }

  try {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await populateDeliveryOrder(Order.find(filters))
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(filters);

    res.json({
      success: true,
      data: {
        orders: serializeDeliveryOrderList(orders),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalOrders: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

/**
 * @function updateAvailability
 * @description Update delivery agent's availability status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {string} req.body.status - New availability status
 * @returns {Object} - Updated availability status
 */
const updateAvailability = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { status } = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update availability.",
    });
  }

  const validStatuses = ["online", "offline", "busy", "unavailable"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status. Must be one of: " + validStatuses.join(", "),
    });
  }

  try {
    const dispatchProfile = await DispatchProfile.findOneAndUpdate(
      { user: _id },
      {
        "availability.status": status,
        lastActiveAt: new Date(),
      },
      { new: true },
    );

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Delivery agent profile not found",
      });
    }

    res.json({
      success: true,
      message: `Availability updated to ${status}`,
      data: {
        availability: dispatchProfile.availability,
        lastActiveAt: dispatchProfile.lastActiveAt,
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

/**
 * @function getOrdersFeed
 * @description Unified rider order feed powering every tab on the orders screen,
 *              including the default "All" tab which combines the available pool
 *              (pending_assignment, open to any rider) with this rider's own
 *              ongoing / completed / cancelled orders in a single paginated call.
 * @param {Object} req - Express request object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @param {string} [req.query.tab=all] - all | available | ongoing | completed | cancelled
 * @param {string} [req.query.search] - Free-text search (order id, customer, address)
 * @param {number} [req.query.month] - Filter by calendar month (1-12)
 * @param {number} [req.query.year] - Filter by calendar year (e.g. 2026)
 * @returns {Object} - Serialized orders + pagination
 * @route GET /api/delivery-agent/orders
 */
const getOrdersFeed = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { page = 1, limit = 10, tab = "all", search, month, year } = req.query;

  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view orders.",
    });
  }

  const tabFilter = buildFeedFilter(tab, _id);
  if (!tabFilter) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid tab. Must be one of: all, available, ongoing, completed, cancelled",
    });
  }

  try {
    // Layer the period dropdown and the search box on top of the tab filter.
    const filters = combineFilters(
      tabFilter,
      buildPeriodFilter(month, year),
      await buildSearchFilter(search),
    );

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await populateDeliveryOrder(Order.find(filters))
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments(filters);

    res.json({
      success: true,
      data: {
        tab,
        orders: serializeDeliveryOrderList(orders),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalOrders: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

/**
 * @function getDeliveryCounts
 * @description Returns the badge counts for the rider's order tabs
 *              (e.g. "Ongoing (3)"), including "all" and the available pool.
 *              Honours the same search / month / year filters as the feed so the
 *              badges stay consistent with the filtered table.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {string} [req.query.search] - Free-text search
 * @param {number} [req.query.month] - Filter by calendar month (1-12)
 * @param {number} [req.query.year] - Filter by calendar year
 * @returns {Object} - { all, available, ongoing, completed, cancelled }
 */
const getDeliveryCounts = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { search, month, year } = req.query;

  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view order counts.",
    });
  }

  const periodFilter = buildPeriodFilter(month, year);
  const searchFilter = await buildSearchFilter(search);
  // Count each tab through the same period/search fragments as the feed. The
  // "all" bucket is counted via its union filter (not a sum) so an order that
  // could match two buckets is never double-counted.
  const countTab = (t) =>
    Order.countDocuments(
      combineFilters(buildFeedFilter(t, _id), periodFilter, searchFilter),
    );

  const [all, available, ongoing, completed, cancelled] = await Promise.all([
    countTab("all"),
    countTab("available"),
    countTab("ongoing"),
    countTab("completed"),
    countTab("cancelled"),
  ]);

  res.json({
    success: true,
    data: { all, available, ongoing, completed, cancelled },
  });
});

module.exports = {
  getAvailableOrders,
  selectOrder,
  updateDeliveryStatus,
  getMyDeliveries,
  getOrdersFeed,
  getDeliveryCounts,
  updateAvailability,
};
