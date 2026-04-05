const asyncHandler = require("express-async-handler");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { customerConfirmDelivery } = require("../../services/dispatchEarningsService");

const confirmDelivery = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  const { _id: customerId } = req.user;

  if (!orderId) {
    return res.status(400).json({ success: false, message: "orderId is required" });
  }

  validateMongodbId(orderId);

  const actorContext = {
    ip: req.headers?.["x-forwarded-for"]?.split(",")[0] || req.ip,
    userAgent: req.headers?.["user-agent"],
  };

  const result = await customerConfirmDelivery(orderId, customerId, actorContext);

  res.json({
    success: true,
    message: result.credited
      ? "Delivery confirmed. Thank you!"
      : result.reason === "awaiting_agent_confirmation"
        ? "Your confirmation has been recorded. Waiting for the agent to confirm."
        : `Delivery already recorded (${result.reason}).`,
    data: result,
  });
});

module.exports = confirmDelivery;
