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
 * @function getUnreadCount
 * @description Get count of unread notifications
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Unread count
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  try {
    const unreadCount = await Notification.countDocuments({
      recipients: _id,
      readBy: { $ne: _id },
      status: { $ne: 'deleted' }
    });

    res.json({
      success: true,
      data: {
        unreadCount: unreadCount
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get unread count");
  }

});

module.exports = getUnreadCount;
