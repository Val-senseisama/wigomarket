const asyncHandler = require("express-async-handler");
const Notification = require("../models/notificationModel");
const NotificationPreferences = require("../models/notificationPreferencesModel");
const User = require("../models/userModel");
const { validateMongodbId } = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");
const firebaseNotificationService = require("../services/firebaseNotificationService");
const Redis = require("ioredis");

// Redis client for real-time notifications
const redisClient = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});


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
      recipients: _id,
      status: { $ne: 'deleted' }
    };
    
    if (type) {
      filter.type = type;
    }
    
    if (unreadOnly === 'true') {
      filter.readBy = { $ne: _id };
    }

    const notifications = await Notification.find(filter)
      .populate('sender', 'fullName email')
      .populate('relatedOrder', 'paymentIntent.id deliveryStatus')
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

// Helper Functions

/**
 * @function createNotification
 * @description Create a new notification (Internal use)
 * @param {Object} notificationData - Notification data
 * @returns {Object} - Created notification
 */
const createNotification = async (notificationData) => {
  try {
    const notification = await Notification.create(notificationData);
    
    // Publish to Redis for real-time updates
    await redisClient.publish('notifications', JSON.stringify({
      type: 'new_notification',
      notification: notification,
      timestamp: new Date()
    }));
    
    return notification;
  } catch (error) {
    console.log('Error creating notification:', error.message);
    throw error;
  }
};

/**
 * @function sendOrderNotification
 * @description Send notification for order events
 * @param {string} orderId - Order ID
 * @param {string} type - Notification type
 * @param {string} message - Notification message
 * @param {Array} recipients - Array of user IDs
 * @returns {Object} - Created notification
 */
const sendOrderNotification = async (orderId, type, message, recipients) => {
  try {
    const notification = await createNotification({
      type: type,
      title: 'Order Update',
      message: message,
      recipients: recipients,
      relatedOrder: orderId,
      priority: 'medium',
      channels: ['in_app', 'push'],
      metadata: {
        orderId: orderId,
        action: 'view_order'
      }
    });

    // Send push notifications
    for (const recipientId of recipients) {
      await firebaseNotificationService.sendNotificationToUser(
        recipientId,
        'Order Update',
        message,
        { orderId, type },
        type
      );
    }

    return notification;
  } catch (error) {
    console.log('Error sending order notification:', error.message);
    throw error;
  }
};

/**
 * @function sendDeliveryAgentNotification
 * @description Send notification to delivery agents
 * @param {string} type - Notification type
 * @param {string} message - Notification message
 * @param {Object} metadata - Additional metadata
 * @returns {Object} - Created notification
 */
const sendDeliveryAgentNotification = async (type, message, metadata = {}) => {
  try {
    // Get all active delivery agents
    const deliveryAgents = await User.find({
      role: { $in: ['dispatch'] },
      status: 'active'
    }).select('_id');

    const recipients = deliveryAgents.map(agent => agent._id);

    const notification = await createNotification({
      type: type,
      title: 'Delivery Update',
      message: message,
      recipients: recipients,
      priority: 'high',
      channels: ['in_app', 'push', 'sms'],
      metadata: metadata
    });

    // Send push notifications
    for (const recipientId of recipients) {
      await firebaseNotificationService.sendNotificationToUser(
        recipientId,
        'Delivery Update',
        message,
        metadata,
        type
      );
    }

    return notification;
  } catch (error) {
    console.log('Error sending delivery agent notification:', error.message);
    throw error;
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getNotificationPreferences,
  updateNotificationPreferences,
  registerFCMToken,
  unregisterFCMToken,
  sendTestNotification,
  createNotification,
  sendOrderNotification,
  sendDeliveryAgentNotification
};