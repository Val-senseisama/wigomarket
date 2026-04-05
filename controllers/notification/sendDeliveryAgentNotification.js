const Notification = require("../../models/notificationModel");
const User = require("../../models/userModel");
const firebaseService = require("../../services/firebaseNotificationService");

/**
 * Broadcast a notification to all dispatch agents.
 * Saves an in-app record per agent and fires push via Firebase role broadcast.
 *
 * @param {string} type     - Notification type (e.g. "dispatch_request")
 * @param {string} message  - Notification body
 * @param {Object} data     - Extra payload (orderId, deliveryAddress, etc.)
 */
const sendDeliveryAgentNotification = async (type, message, data = {}) => {
  const agents = await User.find({ role: { $in: ["dispatch"] } }).select("_id");

  await Promise.all(
    agents.map((agent) =>
      Notification.createNotification({
        recipient: agent._id,
        type: "dispatch_request",
        title: "New Delivery Request",
        message,
        data,
        role: "dispatch",
        ...(data.orderId && {
          relatedEntity: { type: "order", id: data.orderId },
        }),
      }).catch((err) =>
        console.error(`Failed to save dispatch notification for agent ${agent._id}:`, err),
      ),
    ),
  );

  return firebaseService.sendNotificationToRole(
    "dispatch",
    "New Delivery Request",
    message,
    data,
    "deliveryUpdates",
  );
};

module.exports = sendDeliveryAgentNotification;
