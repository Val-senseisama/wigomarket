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
 * @function unregisterFCMToken
 * @description Unregister FCM token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.token - FCM token to remove
 * @returns {Object} - Unregistration result
 */
const unregisterFCMToken = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: "Token is required"
    });
  }

  try {
    const result = await firebaseNotificationService.unregisterFCMToken(_id, token);

    res.json({
      success: true,
      message: "FCM token unregistered successfully",
      data: result
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to unregister FCM token");
  }

});

module.exports = unregisterFCMToken;
