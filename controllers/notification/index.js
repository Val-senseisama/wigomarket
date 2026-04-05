const getNotifications = require('./getNotifications');
const markAsRead = require('./markAsRead');
const markAllAsRead = require('./markAllAsRead');
const deleteNotification = require('./deleteNotification');
const getUnreadCount = require('./getUnreadCount');
const getNotificationPreferences = require('./getNotificationPreferences');
const updateNotificationPreferences = require('./updateNotificationPreferences');
const registerFCMToken = require('./registerFCMToken');
const unregisterFCMToken = require('./unregisterFCMToken');
const sendTestNotification = require('./sendTestNotification');
const createNotification = require('./createNotification');
const sendOrderNotification = require('./sendOrderNotification');
const sendDeliveryAgentNotification = require('./sendDeliveryAgentNotification');

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getNotificationPreferences,
  updateNotificationPreferences,
  registerFCMToken,
  unregisterFCMToken,
  sendTestNotification,
  createNotification,
  sendOrderNotification,
  sendDeliveryAgentNotification
};
