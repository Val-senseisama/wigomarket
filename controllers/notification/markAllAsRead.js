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
 * @function markAllAsRead
 * @description Mark all notifications as read for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Success response
 */
const markAllAsRead = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  try {
    const result = await Notification.updateMany(
      { 
        recipients: _id,
        readBy: { $ne: _id }
      },
      { 
        $addToSet: { readBy: _id },
        $inc: { readCount: 1 }
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      data: {
        modifiedCount: result.modifiedCount
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to mark all notifications as read");
  }

});

module.exports = markAllAsRead;
