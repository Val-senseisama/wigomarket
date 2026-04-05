const Notification = require("../../models/notificationModel");

const createNotification = (notificationData) =>
  Notification.createNotification(notificationData);

module.exports = createNotification;
