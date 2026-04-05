const asyncHandler = require("express-async-handler");
const Notification = require("../../models/notificationModel");
const NotificationPreferences = require("../../models/notificationPreferencesModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const firebaseNotificationService = require("../../services/firebaseNotificationService");
const Redis = require("ioredis");

/**
 * @function sendTestNotification
 * @description Send a test notification to the current user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.title - Notification title
 * @param {string} req.body.body - Notification body
 * @param {string} [req.body.type] - Notification type
 * @returns {Object} - Send result
 */
const sendTestNotification = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { title, body, type = 'systemUpdates' } = req.body;

  if (!title || !body) {
    return res.status(400).json({
      success: false,
      message: "Title and body are required"
    });
  }

  try {
    const result = await firebaseNotificationService.sendNotificationToUser(
      _id,
      title,
      body,
      { test: 'true' },
      type
    );

    res.json({
      success: true,
      message: "Test notification sent",
      data: result
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to send test notification");
  }

});

module.exports = sendTestNotification;
