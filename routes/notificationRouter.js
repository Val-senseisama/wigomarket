const express = require("express");
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
  getNotificationPreferences,
  updateNotificationPreferences,
  registerFCMToken,
  unregisterFCMToken,
  sendTestNotification
} = require("../controllers/notificationController");
const { authMiddleware } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * /api/notifications/notifications:
 *   get:
 *     summary: Get user notifications
 *     description: Get paginated notifications for the authenticated user
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by notification type
 *       - in: query
 *         name: unreadOnly
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Show only unread notifications
 *     responses:
 *       200:
 *         description: Notifications retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *       401:
 *         description: Unauthorized
 */
router.get("/", authMiddleware, getNotifications);

/**
 * @swagger
 * /api/notifications/notifications/read:
 *   post:
 *     summary: Mark notification as read
 *     description: Mark a specific notification as read
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - notificationId
 *             properties:
 *               notificationId:
 *                 type: string
 *                 description: Notification ID to mark as read
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       404:
 *         description: Notification not found
 */
router.post("/read", authMiddleware, markAsRead);

/**
 * @swagger
 * /api/notifications/notifications/read-all:
 *   post:
 *     summary: Mark all notifications as read
 *     description: Mark all notifications as read for the authenticated user
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.post("/read-all", authMiddleware, markAllAsRead);

/**
 * @swagger
 * /api/notifications/notifications/{notificationId}:
 *   delete:
 *     summary: Delete notification
 *     description: Delete a specific notification
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: string
 *         description: Notification ID to delete
 *     responses:
 *       200:
 *         description: Notification deleted successfully
 *       404:
 *         description: Notification not found
 */
router.delete("/:notificationId", authMiddleware, deleteNotification);

/**
 * @swagger
 * /api/notifications/notifications/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     description: Get count of unread notifications for the authenticated user
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     unreadCount:
 *                       type: integer
 */
router.get("/unread-count", authMiddleware, getUnreadCount);

/**
 * @swagger
 * /api/notifications/notifications/preferences:
 *   get:
 *     summary: Get notification preferences
 *     description: Get user's notification preferences
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification preferences retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     pushNotifications:
 *                       type: object
 *                       properties:
 *                         enabled:
 *                           type: boolean
 *                         orderUpdates:
 *                           type: boolean
 *                         deliveryUpdates:
 *                           type: boolean
 *                         promotions:
 *                           type: boolean
 *                         securityAlerts:
 *                           type: boolean
 *                         systemUpdates:
 *                           type: boolean
 *                         chatMessages:
 *                           type: boolean
 *                         ratingReminders:
 *                           type: boolean
 *                     emailNotifications:
 *                       type: object
 *                       properties:
 *                         enabled:
 *                           type: boolean
 *                         orderUpdates:
 *                           type: boolean
 *                         deliveryUpdates:
 *                           type: boolean
 *                         promotions:
 *                           type: boolean
 *                         securityAlerts:
 *                           type: boolean
 *                         systemUpdates:
 *                           type: boolean
 *                         weeklyDigest:
 *                           type: boolean
 *                         monthlyReport:
 *                           type: boolean
 *                     smsNotifications:
 *                       type: object
 *                       properties:
 *                         enabled:
 *                           type: boolean
 *                         orderUpdates:
 *                           type: boolean
 *                         deliveryUpdates:
 *                           type: boolean
 *                         securityAlerts:
 *                           type: boolean
 *                         verificationCodes:
 *                           type: boolean
 *                     quietHours:
 *                       type: object
 *                       properties:
 *                         enabled:
 *                           type: boolean
 *                         startTime:
 *                           type: string
 *                         endTime:
 *                           type: string
 *                         timezone:
 *                           type: string
 *                     frequency:
 *                       type: object
 *                       properties:
 *                         push:
 *                           type: string
 *                           enum: [immediate, batched, daily]
 *                         email:
 *                           type: string
 *                           enum: [immediate, batched, daily, weekly]
 *                     language:
 *                       type: string
 *       401:
 *         description: Unauthorized
 */
router.get("/preferences", authMiddleware, getNotificationPreferences);

/**
 * @swagger
 * /api/notifications/notifications/preferences:
 *   put:
 *     summary: Update notification preferences
 *     description: Update user's notification preferences
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pushNotifications:
 *                 type: object
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                   orderUpdates:
 *                     type: boolean
 *                   deliveryUpdates:
 *                     type: boolean
 *                   promotions:
 *                     type: boolean
 *                   securityAlerts:
 *                     type: boolean
 *                   systemUpdates:
 *                     type: boolean
 *                   chatMessages:
 *                     type: boolean
 *                   ratingReminders:
 *                     type: boolean
 *               emailNotifications:
 *                 type: object
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                   orderUpdates:
 *                     type: boolean
 *                   deliveryUpdates:
 *                     type: boolean
 *                   promotions:
 *                     type: boolean
 *                   securityAlerts:
 *                     type: boolean
 *                   systemUpdates:
 *                     type: boolean
 *                   weeklyDigest:
 *                     type: boolean
 *                   monthlyReport:
 *                     type: boolean
 *               smsNotifications:
 *                 type: object
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                   orderUpdates:
 *                     type: boolean
 *                   deliveryUpdates:
 *                     type: boolean
 *                   securityAlerts:
 *                     type: boolean
 *                   verificationCodes:
 *                     type: boolean
 *               quietHours:
 *                 type: object
 *                 properties:
 *                   enabled:
 *                     type: boolean
 *                   startTime:
 *                     type: string
 *                     pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
 *                   endTime:
 *                     type: string
 *                     pattern: "^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$"
 *                   timezone:
 *                     type: string
 *               frequency:
 *                 type: object
 *                 properties:
 *                   push:
 *                     type: string
 *                     enum: [immediate, batched, daily]
 *                   email:
 *                     type: string
 *                     enum: [immediate, batched, daily, weekly]
 *               language:
 *                 type: string
 *                 enum: [en, fr, es, pt, ar, sw]
 *     responses:
 *       200:
 *         description: Notification preferences updated successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 */
router.put("/preferences", authMiddleware, updateNotificationPreferences);

/**
 * @swagger
 * /api/notifications/notifications/fcm/register:
 *   post:
 *     summary: Register FCM token
 *     description: Register FCM token for push notifications
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - deviceType
 *               - deviceId
 *             properties:
 *               token:
 *                 type: string
 *                 description: FCM token
 *               deviceType:
 *                 type: string
 *                 enum: [android, ios, web]
 *                 description: Device type
 *               deviceId:
 *                 type: string
 *                 description: Unique device identifier
 *     responses:
 *       200:
 *         description: FCM token registered successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 */
router.post("/fcm/register", authMiddleware, registerFCMToken);

/**
 * @swagger
 * /api/notifications/notifications/fcm/unregister:
 *   post:
 *     summary: Unregister FCM token
 *     description: Unregister FCM token for push notifications
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: FCM token to remove
 *     responses:
 *       200:
 *         description: FCM token unregistered successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 */
router.post("/fcm/unregister", authMiddleware, unregisterFCMToken);

/**
 * @swagger
 * /api/notifications/notifications/test:
 *   post:
 *     summary: Send test notification
 *     description: Send a test notification to the current user
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - body
 *             properties:
 *               title:
 *                 type: string
 *                 description: Notification title
 *               body:
 *                 type: string
 *                 description: Notification body
 *               type:
 *                 type: string
 *                 description: Notification type
 *                 default: systemUpdates
 *     responses:
 *       200:
 *         description: Test notification sent successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 */
router.post("/test", authMiddleware, sendTestNotification);

module.exports = router;
