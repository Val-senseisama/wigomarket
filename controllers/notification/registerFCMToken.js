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
 * @function registerFCMToken
 * @description Register FCM token for push notifications
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.token - FCM token
 * @param {string} req.body.deviceType - Device type (android, ios, web)
 * @param {string} req.body.deviceId - Device ID
 * @returns {Object} - Registration result
 */
const registerFCMToken = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { token, deviceType, deviceId } = req.body;

  if (!token || !deviceType || !deviceId) {
    return res.status(400).json({
      success: false,
      message: "Token, device type, and device ID are required"
    });
  }

  const validDeviceTypes = ["android", "ios", "web"];
  if (!validDeviceTypes.includes(deviceType)) {
    return res.status(400).json({
      success: false,
      message: "Invalid device type. Must be one of: " + validDeviceTypes.join(", ")
    });
  }

  try {
    const result = await firebaseNotificationService.registerFCMToken(_id, token, deviceType, deviceId);

    res.json({
      success: true,
      message: "FCM token registered successfully",
      data: result
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to register FCM token");
  }

});

module.exports = registerFCMToken;
