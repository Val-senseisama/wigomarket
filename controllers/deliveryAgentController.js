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

// Maps the rider app's Ongoing / Completed / Cancelled tabs onto the underlying
// deliveryStatus values. "cancelled" also matches orders the seller cancelled
// (orderStatus === "cancelled") even if the rider never marked them failed.
const TAB_FILTERS = {
  ongoing: { deliveryStatus: { $in: ["assigned", "picked_up", "in_transit"] } },
  completed: { deliveryStatus: "delivered" },
  cancelled: {
    $or: [{ deliveryStatus: "failed" }, { orderStatus: "cancelled" }],
  },
};

// Standard population for rider order responses, consumed by serializeDeliveryOrder.
const populateDeliveryOrder = (query) =>
  query
    .populate("products.product", "title listedPrice images brand")
    .populate("products.store", "name address mobile location")
    .populate("orderedBy", "firstname lastname fullName email mobile");

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
  if (!dispatchProfile || !dispatchProfile.isActive) {
    return res.status(400).json({
      success: false,
      message: "Delivery agent profile not found or not active",
    });
  }

  // Build filter for available orders
  const filters = {
    deliveryMethod: "delivery_agent",
    deliveryStatus: status || "pending_assignment",
    orderStatus: { $ne: "cancelled" },
  };

  // If looking for pending assignments, exclude orders already assigned to this agent
  if (status === "pending_assignment") {
    filters.deliveryAgent = { $exists: false };
  } else if (status === "assigned") {
    filters.deliveryAgent = _id;
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
    if (!dispatchProfile || !dispatchProfile.isActive) {
      return res.status(400).json({
        success: false,
        message: "Delivery agent profile not found or not active",
      });
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
 * @function getDeliveryCounts
 * @description Returns the badge counts for the rider's order tabs
 *              (e.g. "Ongoing (3)"), plus the size of the available pool.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @returns {Object} - { ongoing, completed, cancelled, available }
 */
const getDeliveryCounts = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view order counts.",
    });
  }

  const mine = { deliveryAgent: _id, deliveryMethod: "delivery_agent" };

  const [ongoing, completed, cancelled, available] = await Promise.all([
    Order.countDocuments({ ...mine, ...TAB_FILTERS.ongoing }),
    Order.countDocuments({ ...mine, ...TAB_FILTERS.completed }),
    Order.countDocuments({ ...mine, ...TAB_FILTERS.cancelled }),
    Order.countDocuments({
      deliveryMethod: "delivery_agent",
      deliveryStatus: "pending_assignment",
      deliveryAgent: { $exists: false },
      orderStatus: { $ne: "cancelled" },
    }),
  ]);

  res.json({
    success: true,
    data: { ongoing, completed, cancelled, available },
  });
});

module.exports = {
  getAvailableOrders,
  selectOrder,
  updateDeliveryStatus,
  getMyDeliveries,
  getDeliveryCounts,
  updateAvailability,
};
