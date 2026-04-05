const Notification = require("../../models/notificationModel");
const firebaseService = require("../../services/firebaseNotificationService");

/**
 * Send an order notification to a customer.
 * Saves an in-app notification record and fires a push notification.
 *
 * @param {string} userId   - Recipient user ID
 * @param {string} title    - Notification title
 * @param {string} body     - Notification body
 * @param {Object} data     - Extra payload (orderId, orderNumber, etc.)
 * @param {string} orderId  - Related order ID (for relatedEntity)
 */
const sendOrderNotification = async (userId, title, body, data = {}, orderId) => {
  await Notification.createNotification({
    recipient: userId,
    type: "order_placed",
    title,
    message: body,
    data,
    role: "buyer",
    ...(orderId && { relatedEntity: { type: "order", id: orderId } }),
  });

  return firebaseService.sendNotificationToUser(userId, title, body, data, "orderUpdates");
};

module.exports = sendOrderNotification;
