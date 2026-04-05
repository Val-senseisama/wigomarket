const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { sendAgentAssignedEmail } = require("../../services/dispatchEmailService");
const audit = require("../../services/auditService");

const takeDispatch = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  const agentId = req.user._id;

  if (!orderId) {
    return res.status(400).json({ success: false, message: "orderId is required" });
  }

  validateMongodbId(orderId);

  const order = await Order.findOneAndUpdate(
    {
      _id: orderId,
      deliveryMethod: "delivery_agent",
      deliveryStatus: "pending_assignment",
    },
    {
      $set: {
        deliveryAgent: agentId,
        dispatch: agentId,
        deliveryStatus: "assigned",
        orderStatus: "Dispatched",
      },
    },
    { new: true }
  ).populate("orderedBy", "fullName email");

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found or already assigned",
    });
  }

  audit.log({
    action: "dispatch.taken",
    actor: audit.actor(req),
    resource: { type: "order", id: order._id },
    changes: { before: { deliveryStatus: "pending_assignment" }, after: { deliveryStatus: "assigned", deliveryAgent: agentId } },
  });

  // Email customer — non-blocking
  const agent = await User.findById(agentId).select("fullName");
  sendAgentAssignedEmail(order.orderedBy, agent, order);

  res.json({ success: true, data: order });
});

module.exports = takeDispatch;
