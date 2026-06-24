const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const {
  transitionOrder,
  OrderTransitionError,
  ROLE,
} = require("../../services/orderTransitionService");

/**
 * @function updateOrderStatus
 * @description Seller-driven order status transition. Enforced by the order
 *   state machine: a seller may only advance their own store's orders through
 *   pending → confirmed → preparing → pickUpReady (and pickUpReady → delivered
 *   for pickup/self_delivery orders), or cancel a pre-shipment order.
 * @access Seller (isSeller sets req.store)
 * @param {string} req.params.id  - Order ID
 * @param {string} req.body.status - Target canonical status
 * @param {string} [req.body.reason] - Optional reason (recorded in audit log)
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;

  validateMongodbId(id);

  if (!status) {
    return res
      .status(400)
      .json({ success: false, message: "status is required" });
  }

  if (!req.store) {
    return res
      .status(404)
      .json({ success: false, message: "No store found for this account" });
  }

  // Ownership: the order must contain at least one product from this seller's store.
  const owns = await Order.exists({ _id: id, "products.store": req.store });
  if (!owns) {
    return res.status(403).json({
      success: false,
      message: "This order does not belong to your store",
    });
  }

  try {
    const order = await transitionOrder({
      orderId: id,
      toStatus: status,
      role: ROLE.SELLER,
      req,
      reason,
    });
    res.json({ success: true, data: order });
  } catch (error) {
    if (error instanceof OrderTransitionError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    throw error;
  }
});

module.exports = updateOrderStatus;
