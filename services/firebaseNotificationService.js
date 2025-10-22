const admin = require('firebase-admin');
const User = require('../models/userModel');
const NotificationPreferences = require('../models/notificationPreferencesModel');
const { sendEmail } = require('../controllers/emailController');

// Initialize Firebase Admin SDK
let firebaseApp;
try {
  // Check if Firebase is already initialized
  if (admin.apps.length === 0) {
    // Check if Firebase service account JSON is present
    if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      console.warn('FIREBASE_SERVICE_ACCOUNT_JSON not configured. Push notifications will be disabled.');
      firebaseApp = null;
    } else {
      // Parse the service account JSON
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      
      // Ensure private key has proper line breaks
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }

      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id
      });
      
      console.log('Firebase Admin SDK initialized successfully');
    }
  } else {
    firebaseApp = admin.app();
  }
} catch (error) {
  console.error('Firebase initialization error:', error);
  firebaseApp = null;
}

/**
 * @function sendNotificationToUser
 * @description Send push notification to a specific user
 * @param {string} userId - User ID
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} data - Additional data payload
 * @param {string} type - Notification type (orderUpdates, deliveryUpdates, etc.)
 * @returns {Object} - Send result
 */
const sendNotificationToUser = async (userId, title, body, data = {}, type = 'systemUpdates') => {
  try {
    // Check if Firebase is initialized
    if (!firebaseApp) {
      console.warn('Firebase not initialized. Skipping push notification.');
      return { success: false, message: 'Firebase not configured' };
    }

    // Get user and their notification preferences
    const user = await User.findById(userId).select('fcmTokens fullName email');
    if (!user) {
      throw new Error('User not found');
    }

    const preferences = await NotificationPreferences.findOne({ user: userId });
    if (!preferences) {
      // Create default preferences if none exist
      await NotificationPreferences.create({ user: userId });
      return { success: false, message: 'No notification preferences found' };
    }

    // Check if user wants to receive this type of notification
    const shouldReceivePush = preferences.shouldReceiveNotification(type, 'push');
    const shouldReceiveEmail = preferences.shouldReceiveNotification(type, 'email');

    const results = {
      push: { sent: false, result: null },
      email: { sent: false, result: null }
    };

    // Send push notification
    if (shouldReceivePush && user.fcmTokens && user.fcmTokens.length > 0) {
      const activeTokens = user.fcmTokens
        .filter(token => token.isActive)
        .map(token => token.token);

      if (activeTokens.length > 0) {
        const message = {
          notification: {
            title,
            body,
          },
          data: {
            ...data,
            type,
            userId: userId,
            timestamp: new Date().toISOString()
          },
          tokens: activeTokens,
          webpush: {
            notification: {
              icon: process.env.NOTIFICATION_ICON_URL || "https://via.placeholder.com/64",
              badge: process.env.NOTIFICATION_BADGE_URL || "https://via.placeholder.com/32",
              requireInteraction: true
            }
          },
          android: {
            notification: {
              icon: "ic_notification",
              color: "#4CAF50",
              sound: "default",
              priority: "high"
            }
          },
          apns: {
            payload: {
              aps: {
                sound: "default",
                badge: 1
              }
            }
          }
        };

        const pushResult = await admin.messaging().sendEachForMulticast(message);
        results.push = {
          sent: true,
          result: pushResult,
          successCount: pushResult.successCount,
          failureCount: pushResult.failureCount
        };

        // Remove failed tokens
        if (pushResult.failureCount > 0) {
          const failedTokens = [];
          pushResult.responses.forEach((response, index) => {
            if (!response.success) {
              failedTokens.push(activeTokens[index]);
            }
          });
          
          if (failedTokens.length > 0) {
            await User.findByIdAndUpdate(userId, {
              $pull: { fcmTokens: { token: { $in: failedTokens } } }
            });
          }
        }
      }
    }

    // Send email notification
    if (shouldReceiveEmail && user.email) {
      const emailData = {
        to: user.email,
        subject: title,
        text: body,
        htm: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${title}</h2>
            <p style="color: #666; font-size: 16px;">${body}</p>
            <div style="margin-top: 20px; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
              <p style="margin: 0; font-size: 14px; color: #888;">
                This is an automated notification from WigoMarket.
              </p>
            </div>
          </div>
        `
      };

      try {
        await sendEmail(emailData);
        results.email = { sent: true, result: 'Email sent successfully' };
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        results.email = { sent: false, result: emailError.message };
      }
    }

    return {
      success: results.push.sent || results.email.sent,
      results
    };

  } catch (error) {
    console.error('Notification sending error:', error);
    throw error;
  }
};

/**
 * @function sendNotificationToUsers
 * @description Send push notification to multiple users
 * @param {Array} userIds - Array of user IDs
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} data - Additional data payload
 * @param {string} type - Notification type
 * @returns {Object} - Send results
 */
const sendNotificationToUsers = async (userIds, title, body, data = {}, type = 'systemUpdates') => {
  const results = {
    totalUsers: userIds.length,
    successCount: 0,
    failureCount: 0,
    details: []
  };

  for (const userId of userIds) {
    try {
      const result = await sendNotificationToUser(userId, title, body, data, type);
      results.details.push({
        userId,
        success: result.success,
        results: result.results
      });
      
      if (result.success) {
        results.successCount++;
      } else {
        results.failureCount++;
      }
    } catch (error) {
      console.error(`Error sending notification to user ${userId}:`, error);
      results.details.push({
        userId,
        success: false,
        error: error.message
      });
      results.failureCount++;
    }
  }

  return results;
};

/**
 * @function sendNotificationToRole
 * @description Send notification to all users with a specific role
 * @param {string} role - User role (buyer, seller, dispatch, admin)
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} data - Additional data payload
 * @param {string} type - Notification type
 * @returns {Object} - Send results
 */
const sendNotificationToRole = async (role, title, body, data = {}, type = 'systemUpdates') => {
  try {
    const users = await User.find({ role: { $in: [role] } }).select('_id');
    const userIds = users.map(user => user._id.toString());
    
    return await sendNotificationToUsers(userIds, title, body, data, type);
  } catch (error) {
    console.error('Error sending notification to role:', error);
    throw error;
  }
};

/**
 * @function registerFCMToken
 * @description Register or update FCM token for a user
 * @param {string} userId - User ID
 * @param {string} token - FCM token
 * @param {string} deviceType - Device type (android, ios, web)
 * @param {string} deviceId - Unique device identifier
 * @returns {Object} - Registration result
 */
const registerFCMToken = async (userId, token, deviceType, deviceId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if token already exists
    const existingToken = user.fcmTokens.find(t => t.token === token);
    
    if (existingToken) {
      // Update existing token
      existingToken.lastUsed = new Date();
      existingToken.isActive = true;
      existingToken.deviceType = deviceType;
      existingToken.deviceId = deviceId;
    } else {
      // Add new token
      user.fcmTokens.push({
        token,
        deviceType,
        deviceId,
        lastUsed: new Date(),
        isActive: true
      });
    }

    // Limit to 5 tokens per user (remove oldest if exceeded)
    if (user.fcmTokens.length > 5) {
      user.fcmTokens.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
      user.fcmTokens = user.fcmTokens.slice(0, 5);
    }

    await user.save();

    return {
      success: true,
      message: 'FCM token registered successfully',
      tokenCount: user.fcmTokens.length
    };
  } catch (error) {
    console.error('FCM token registration error:', error);
    throw error;
  }
};

/**
 * @function unregisterFCMToken
 * @description Remove FCM token for a user
 * @param {string} userId - User ID
 * @param {string} token - FCM token to remove
 * @returns {Object} - Unregistration result
 */
const unregisterFCMToken = async (userId, token) => {
  try {
    const result = await User.findByIdAndUpdate(
      userId,
      { $pull: { fcmTokens: { token } } },
      { new: true }
    );

    return {
      success: true,
      message: 'FCM token unregistered successfully',
      tokenCount: result.fcmTokens.length
    };
  } catch (error) {
    console.error('FCM token unregistration error:', error);
    throw error;
  }
};

/**
 * @function sendBulkNotification
 * @description Send notification to users based on criteria
 * @param {Object} criteria - User selection criteria
 * @param {string} title - Notification title
 * @param {string} body - Notification body
 * @param {Object} data - Additional data payload
 * @param {string} type - Notification type
 * @returns {Object} - Send results
 */
const sendBulkNotification = async (criteria, title, body, data = {}, type = 'systemUpdates') => {
  try {
    const users = await User.find(criteria).select('_id');
    const userIds = users.map(user => user._id.toString());
    
    return await sendNotificationToUsers(userIds, title, body, data, type);
  } catch (error) {
    console.error('Bulk notification error:', error);
    throw error;
  }
};

module.exports = {
  sendNotificationToUser,
  sendNotificationToUsers,
  sendNotificationToRole,
  registerFCMToken,
  unregisterFCMToken,
  sendBulkNotification
};
