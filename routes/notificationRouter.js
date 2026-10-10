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
  sendTestNotification,
} = require("../controllers/notificationController");
const { authMiddleware } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * /api/notifications:
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
 * /api/notifications/read:
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
 * /api/notifications/read-all:
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
 * /api/notifications/{notificationId}:
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
 * /api/notifications/unread-count:
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
 * components:
 *   schemas:
 *     NotificationPreferences:
 *       type: object
 *       description: >
 *         A user's notification settings. Every group is always present with
 *         defaults filled in.
 *       properties:
 *         pushNotifications:
 *           type: object
 *           description: Push channel. `enabled` is the master switch; each other key mutes one notification type.
 *           properties:
 *             enabled:
 *               type: boolean
 *             orderUpdates:
 *               type: boolean
 *             deliveryUpdates:
 *               type: boolean
 *             promotions:
 *               type: boolean
 *             securityAlerts:
 *               type: boolean
 *             systemUpdates:
 *               type: boolean
 *             chatMessages:
 *               type: boolean
 *             ratingReminders:
 *               type: boolean
 *         emailNotifications:
 *           type: object
 *           description: Email channel. `enabled` is the master switch.
 *           properties:
 *             enabled:
 *               type: boolean
 *             orderUpdates:
 *               type: boolean
 *             deliveryUpdates:
 *               type: boolean
 *             promotions:
 *               type: boolean
 *             securityAlerts:
 *               type: boolean
 *             systemUpdates:
 *               type: boolean
 *             weeklyDigest:
 *               type: boolean
 *             monthlyReport:
 *               type: boolean
 *         smsNotifications:
 *           type: object
 *           description: SMS channel. `enabled` is the master switch.
 *           properties:
 *             enabled:
 *               type: boolean
 *             orderUpdates:
 *               type: boolean
 *             deliveryUpdates:
 *               type: boolean
 *             securityAlerts:
 *               type: boolean
 *             verificationCodes:
 *               type: boolean
 *         quietHours:
 *           type: object
 *           description: Push notifications are held back between startTime (inclusive) and endTime (exclusive) in `timezone`. The window may cross midnight. Email/SMS are unaffected.
 *           properties:
 *             enabled:
 *               type: boolean
 *             startTime:
 *               type: string
 *               pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
 *               example: "22:00"
 *             endTime:
 *               type: string
 *               pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
 *               example: "08:00"
 *             timezone:
 *               type: string
 *               description: IANA timezone name
 *               example: Africa/Lagos
 *         frequency:
 *           type: object
 *           properties:
 *             push:
 *               type: string
 *               enum: [immediate, batched, daily]
 *             email:
 *               type: string
 *               enum: [immediate, batched, daily, weekly]
 *         language:
 *           type: string
 *           enum: [en, fr, es, pt, ar, sw]
 *         lastUpdated:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: When the user last saved their preferences (null if never).
 *     NotificationPreferencesUpdate:
 *       type: object
 *       minProperties: 1
 *       additionalProperties: false
 *       description: >
 *         Partial update - send only the keys that change. Nested groups are
 *         merged, not replaced, so pushNotifications.promotions=false flips
 *         that single toggle and leaves the rest alone.
 *       properties:
 *         pushNotifications:
 *           type: object
 *           description: Push channel. `enabled` is the master switch; each other key mutes one notification type.
 *           properties:
 *             enabled:
 *               type: boolean
 *             orderUpdates:
 *               type: boolean
 *             deliveryUpdates:
 *               type: boolean
 *             promotions:
 *               type: boolean
 *             securityAlerts:
 *               type: boolean
 *             systemUpdates:
 *               type: boolean
 *             chatMessages:
 *               type: boolean
 *             ratingReminders:
 *               type: boolean
 *         emailNotifications:
 *           type: object
 *           description: Email channel. `enabled` is the master switch.
 *           properties:
 *             enabled:
 *               type: boolean
 *             orderUpdates:
 *               type: boolean
 *             deliveryUpdates:
 *               type: boolean
 *             promotions:
 *               type: boolean
 *             securityAlerts:
 *               type: boolean
 *             systemUpdates:
 *               type: boolean
 *             weeklyDigest:
 *               type: boolean
 *             monthlyReport:
 *               type: boolean
 *         smsNotifications:
 *           type: object
 *           description: SMS channel. `enabled` is the master switch.
 *           properties:
 *             enabled:
 *               type: boolean
 *             orderUpdates:
 *               type: boolean
 *             deliveryUpdates:
 *               type: boolean
 *             securityAlerts:
 *               type: boolean
 *             verificationCodes:
 *               type: boolean
 *         quietHours:
 *           type: object
 *           description: Push notifications are held back between startTime (inclusive) and endTime (exclusive) in `timezone`. The window may cross midnight. Email/SMS are unaffected.
 *           properties:
 *             enabled:
 *               type: boolean
 *             startTime:
 *               type: string
 *               pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
 *               example: "22:00"
 *             endTime:
 *               type: string
 *               pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$"
 *               example: "08:00"
 *             timezone:
 *               type: string
 *               description: IANA timezone name
 *               example: Africa/Lagos
 *         frequency:
 *           type: object
 *           properties:
 *             push:
 *               type: string
 *               enum: [immediate, batched, daily]
 *             email:
 *               type: string
 *               enum: [immediate, batched, daily, weekly]
 *         language:
 *           type: string
 *           enum: [en, fr, es, pt, ar, sw]
 */

/**
 * @swagger
 * /api/notifications/preferences:
 *   get:
 *     summary: Get notification preferences
 *     description: >
 *       The authenticated user's notification settings (buyers, sellers and
 *       riders all use this endpoint). A user who has never saved settings gets
 *       the defaults, which are persisted on first read.
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
 *                   $ref: '#/components/schemas/NotificationPreferences'
 *       401:
 *         description: Unauthorized
 */
router.get("/preferences", authMiddleware, getNotificationPreferences);

/**
 * @swagger
 * /api/notifications/preferences:
 *   put:
 *     summary: Update notification preferences
 *     description: >
 *       Partial update of the authenticated user's notification settings. Only
 *       the keys present in the body change; nested groups are merged, so a
 *       single toggle can be flipped without resending the rest. Returns the
 *       full, updated preferences.
 *     tags:
 *       - Notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/NotificationPreferencesUpdate'
 *           examples:
 *             muteMarketing:
 *               summary: Turn off promotional push notifications
 *               value:
 *                 pushNotifications:
 *                   promotions: false
 *             quietHours:
 *               summary: Enable quiet hours overnight
 *               value:
 *                 quietHours:
 *                   enabled: true
 *                   startTime: "22:00"
 *                   endTime: "07:00"
 *     responses:
 *       200:
 *         description: Notification preferences updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: Notification preferences updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/NotificationPreferences'
 *       400:
 *         description: >
 *           Invalid body - empty body, unknown key (e.g. "Unknown preference:
 *           pushNotifications.promos"), non-boolean toggle, value outside an
 *           enum, quiet-hours time not in HH:mm, or an invalid timezone.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.put("/preferences", authMiddleware, updateNotificationPreferences);

/**
 * @swagger
 * /api/notifications/fcm/register:
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
 * /api/notifications/fcm/unregister:
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
 * /api/notifications/test:
 *   post:
 *     summary: Send test notification
 *     description: Send a test notification to the current user (dispatched via background queue)
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
