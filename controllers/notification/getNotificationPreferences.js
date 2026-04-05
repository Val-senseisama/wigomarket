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
 * @function getNotificationPreferences
 * @description Get user's notification preferences
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Notification preferences
 */
const getNotificationPreferences = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  try {
    let preferences = await NotificationPreferences.findOne({ user: _id });

    if (!preferences) {
      // Create default preferences
      preferences = await NotificationPreferences.create({ user: _id });
    }

    res.json({
      success: true,
      data: preferences
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get notification preferences");
  }

});

module.exports = getNotificationPreferences;
