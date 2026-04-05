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
 * @function getNotifications
 * @description Get notifications for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=20] - Items per page
 * @param {string} [req.query.type] - Filter by notification type
 * @param {boolean} [req.query.unreadOnly=false] - Show only unread notifications
 * @returns {Object} - Notifications data
 */
const getNotifications = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { page = 1, limit = 20, type, unreadOnly = false } = req.query;

  try {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build filter
    const filter = {
      recipient: _id,
      status: { $in: ["pending", "sent", "delivered"] },
    };

    if (type) {
      filter.type = type;
    }

    if (unreadOnly === 'true') {
      filter["channels.inApp.read"] = false;
    }

    const notifications = await Notification.find(filter)
      .populate('sender', 'fullName email')
      .populate('relatedEntity.id')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);

    res.json({
      success: true,
      data: {
        notifications,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalNotifications: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get notifications");
  }

});

module.exports = getNotifications;
