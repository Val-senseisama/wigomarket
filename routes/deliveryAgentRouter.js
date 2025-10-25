const express = require("express");
const {
  getAvailableOrders,
  selectOrder,
  updateDeliveryStatus,
  getMyDeliveries,
  updateAvailability
} = require("../controllers/deliveryAgentController");
const {
  createDispatchProfile,
  updateDispatchProfile,
  getDispatchProfile,
  getEarnings,
  getDashboardStats,
} = require("../controllers/dispatchController");
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getUnreadCount,
} = require("../controllers/notificationController");
const { authMiddleware, isDispatch } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/orders/available:
 *   get:
 *     summary: Get orders available for delivery agent assignment
 *     description: Get orders that are pending assignment to delivery agents
 *     tags:
 *       - Delivery Agent
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
 *           default: 10
 *         description: Number of orders per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending_assignment, assigned, picked_up, in_transit, delivered, failed]
 *         description: Filter by delivery status
 *     responses:
 *       200:
 *         description: Available orders retrieved successfully
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
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           products:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 product:
 *                                   type: object
 *                                 count:
 *                                   type: number
 *                                 price:
 *                                   type: number
 *                           deliveryMethod:
 *                             type: string
 *                           deliveryAddress:
 *                             type: string
 *                           deliveryStatus:
 *                             type: string
 *                           deliveryFee:
 *                             type: number
 *                           orderedBy:
 *                             type: object
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: number
 *                         totalPages:
 *                           type: number
 *                         totalOrders:
 *                           type: number
 *                         hasNext:
 *                           type: boolean
 *                         hasPrev:
 *                           type: boolean
 *       403:
 *         description: Access denied - not a delivery agent
 *       400:
 *         description: Delivery agent profile not found or not active
 */
router.get("/orders/available", authMiddleware, isDispatch, getAvailableOrders);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/orders/select:
 *   post:
 *     summary: Select an order for delivery
 *     description: Delivery agent selects an available order for delivery
 *     tags:
 *       - Delivery Agent
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: string
 *                 description: ID of the order to select
 *     responses:
 *       200:
 *         description: Order selected successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     order:
 *                       type: object
 *                     estimatedDeliveryTime:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request or order not available
 *       403:
 *         description: Access denied - not a delivery agent
 *       404:
 *         description: Order not found
 */
router.post("/orders/select", authMiddleware, isDispatch, selectOrder);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/orders/status:
 *   put:
 *     summary: Update delivery status
 *     description: Update the delivery status of an assigned order
 *     tags:
 *       - Delivery Agent
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *               - status
 *             properties:
 *               orderId:
 *                 type: string
 *                 description: ID of the order to update
 *               status:
 *                 type: string
 *                 enum: [assigned, picked_up, in_transit, delivered, failed]
 *                 description: New delivery status
 *               notes:
 *                 type: string
 *                 description: Optional delivery notes
 *     responses:
 *       200:
 *         description: Delivery status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid request or status
 *       403:
 *         description: Access denied - not a delivery agent
 *       404:
 *         description: Order not found or not assigned to agent
 */
router.put("/orders/status", authMiddleware, isDispatch, updateDeliveryStatus);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/orders/my-deliveries:
 *   get:
 *     summary: Get my deliveries
 *     description: Get orders assigned to the current delivery agent
 *     tags:
 *       - Delivery Agent
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
 *           default: 10
 *         description: Number of orders per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [assigned, picked_up, in_transit, delivered, failed]
 *         description: Filter by delivery status
 *     responses:
 *       200:
 *         description: My deliveries retrieved successfully
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
 *                     orders:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *       403:
 *         description: Access denied - not a delivery agent
 */
router.get("/orders/my-deliveries", authMiddleware, isDispatch, getMyDeliveries);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/availability:
 *   put:
 *     summary: Update availability status
 *     description: Update delivery agent's availability status
 *     tags:
 *       - Delivery Agent
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [online, offline, busy, unavailable]
 *                 description: New availability status
 *     responses:
 *       200:
 *         description: Availability updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     availability:
 *                       type: object
 *                     lastActiveAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid status
 *       403:
 *         description: Access denied - not a delivery agent
 *       404:
 *         description: Delivery agent profile not found
 */
router.put("/availability", authMiddleware, isDispatch, updateAvailability);

// Dispatch Profile Management Routes
/**
 * @swagger
 * /api/delivery-agent/delivery-agent/profile:
 *   post:
 *     summary: Create dispatch profile
 *     description: Create a dispatch profile for delivery agent
 *     tags: [Delivery Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vehicleInfo
 *               - documents
 *             properties:
 *               vehicleInfo:
 *                 type: object
 *                 properties:
 *                   type:
 *                     type: string
 *                     enum: [bike, motorcycle, car, van, truck]
 *                   make:
 *                     type: string
 *                   model:
 *                     type: string
 *                   year:
 *                     type: number
 *                   plateNumber:
 *                     type: string
 *                   color:
 *                     type: string
 *               coverageAreas:
 *                 type: array
 *                 items:
 *                   type: string
 *               documents:
 *                 type: object
 *                 properties:
 *                   driverLicense:
 *                     type: object
 *                     properties:
 *                       number:
 *                         type: string
 *                       expiryDate:
 *                         type: string
 *                         format: date
 *                       image:
 *                         type: string
 *                   vehicleRegistration:
 *                     type: object
 *                     properties:
 *                       number:
 *                         type: string
 *                       expiryDate:
 *                         type: string
 *                         format: date
 *                       image:
 *                         type: string
 *                   insurance:
 *                     type: object
 *                     properties:
 *                       provider:
 *                         type: string
 *                       policyNumber:
 *                         type: string
 *                       expiryDate:
 *                         type: string
 *                         format: date
 *                       image:
 *                         type: string
 *               workingHours:
 *                 type: object
 *                 properties:
 *                   start:
 *                     type: string
 *                   end:
 *                     type: string
 *               workingDays:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [monday, tuesday, wednesday, thursday, friday, saturday, sunday]
 *     responses:
 *       200:
 *         description: Dispatch profile created successfully
 *       400:
 *         description: Invalid request or profile already exists
 *       403:
 *         description: Access denied - delivery agent only
 */
router.post("/profile", authMiddleware, isDispatch, createDispatchProfile);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/profile:
 *   get:
 *     summary: Get dispatch profile
 *     description: Get current user's dispatch profile
 *     tags: [Delivery Agent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dispatch profile retrieved successfully
 *       404:
 *         description: Dispatch profile not found
 */
router.get("/profile", authMiddleware, isDispatch, getDispatchProfile);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/profile:
 *   put:
 *     summary: Update dispatch profile
 *     description: Update current user's dispatch profile
 *     tags: [Delivery Agent]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vehicleInfo:
 *                 type: object
 *               coverageAreas:
 *                 type: array
 *                 items:
 *                   type: string
 *               documents:
 *                 type: object
 *               workingHours:
 *                 type: object
 *               workingDays:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Dispatch profile updated successfully
 *       404:
 *         description: Dispatch profile not found
 */
router.put("/profile", authMiddleware, isDispatch, updateDispatchProfile);

// Earnings and Analytics Routes
/**
 * @swagger
 * /api/delivery-agent/delivery-agent/earnings:
 *   get:
 *     summary: Get earnings and analytics
 *     description: Get delivery agent earnings and analytics
 *     tags: [Delivery Agent]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, year]
 *           default: month
 *         description: Time period for earnings
 *     responses:
 *       200:
 *         description: Earnings data retrieved successfully
 *       403:
 *         description: Access denied - delivery agent only
 */
router.get("/earnings", authMiddleware, isDispatch, getEarnings);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/dashboard:
 *   get:
 *     summary: Get dashboard statistics
 *     description: Get dashboard statistics for delivery agent
 *     tags: [Delivery Agent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
 *       403:
 *         description: Access denied - delivery agent only
 */
router.get("/dashboard", authMiddleware, isDispatch, getDashboardStats);

// Notification Routes
/**
 * @swagger
 * /api/delivery-agent/delivery-agent/notifications:
 *   get:
 *     summary: Get notifications
 *     description: Get notifications for delivery agent
 *     tags: [Delivery Agent]
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
 */
router.get("/notifications", authMiddleware, isDispatch, getNotifications);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/notifications/read:
 *   post:
 *     summary: Mark notification as read
 *     description: Mark a specific notification as read
 *     tags: [Delivery Agent]
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
router.post("/notifications/read", authMiddleware, isDispatch, markAsRead);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/notifications/read-all:
 *   post:
 *     summary: Mark all notifications as read
 *     description: Mark all notifications as read for the delivery agent
 *     tags: [Delivery Agent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All notifications marked as read
 */
router.post("/notifications/read-all", authMiddleware, isDispatch, markAllAsRead);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/notifications/{notificationId}:
 *   delete:
 *     summary: Delete notification
 *     description: Delete a specific notification
 *     tags: [Delivery Agent]
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
router.delete("/notifications/:notificationId", authMiddleware, isDispatch, deleteNotification);

/**
 * @swagger
 * /api/delivery-agent/delivery-agent/notifications/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     description: Get count of unread notifications for delivery agent
 *     tags: [Delivery Agent]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Unread count retrieved successfully
 */
router.get("/notifications/unread-count", authMiddleware, isDispatch, getUnreadCount);

module.exports = router;
