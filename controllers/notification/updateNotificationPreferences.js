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
 * @function updateNotificationPreferences
 * @description Update user's notification preferences
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Updated preferences
 * @returns {Object} - Updated preferences
 */
const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const updateData = req.body;

  try {
    const preferences = await NotificationPreferences.findOneAndUpdate(
      { user: _id },
      { 
        ...updateData,
        lastUpdated: new Date()
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.json({
      success: true,
      message: "Notification preferences updated successfully",
      data: preferences
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to update notification preferences");
  }

});

module.exports = updateNotificationPreferences;
