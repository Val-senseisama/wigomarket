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
 * @function markAsRead
 * @description Mark notification as read
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.notificationId - Notification ID
 * @returns {Object} - Success response
 */
const markAsRead = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { notificationId } = req.body;

  if (!notificationId) {
    return res.status(400).json({
      success: false,
      message: "Notification ID is required"
    });
  }

  validateMongodbId(notificationId);

  try {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { 
        $addToSet: { readBy: _id },
        $inc: { readCount: 1 }
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found"
      });
    }

    res.json({
      success: true,
      message: "Notification marked as read",
      data: notification
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to mark notification as read");
  }

});

module.exports = markAsRead;
