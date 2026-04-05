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
 * @function deleteNotification
 * @description Delete a notification
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.notificationId - Notification ID
 * @returns {Object} - Success response
 */
const deleteNotification = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { notificationId } = req.params;

  validateMongodbId(notificationId);

  try {
    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { 
        $addToSet: { deletedBy: _id },
        status: 'deleted'
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
      message: "Notification deleted",
      data: notification
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to delete notification");
  }

});

module.exports = deleteNotification;
