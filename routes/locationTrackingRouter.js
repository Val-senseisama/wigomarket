const express = require("express");
const {
  updateLocation,
  getRoute,
  getCurrentLocation,
  getTrackingHistory,
  updateDeliveryStatus
} = require("../controllers/locationTrackingController");
const { authMiddleware, isDispatch } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * /location/update:
 *   post:
 *     summary: Update delivery agent location
 *     description: Update current location of delivery agent
 *     tags:
 *       - Location Tracking
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - latitude
 *               - longitude
 *               - orderId
 *             properties:
 *               latitude:
 *                 type: number
 *                 description: Current latitude
 *               longitude:
 *                 type: number
 *                 description: Current longitude
 *               orderId:
 *                 type: string
 *                 description: Order ID being delivered
 *               accuracy:
 *                 type: number
 *                 description: Location accuracy in meters
 *               speed:
 *                 type: number
 *                 description: Current speed in km/h
 *               heading:
 *                 type: number
 *                 description: Current heading in degrees
 *     responses:
 *       200:
 *         description: Location updated successfully
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
 *                     location:
 *                       type: object
 *                       properties:
 *                         latitude:
 *                           type: number
 *                         longitude:
 *                           type: number
 *                         address:
 *                           type: string
 *                         accuracy:
 *                           type: number
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *                     status:
 *                       type: string
 *       400:
 *         description: Invalid request data
 *       403:
 *         description: Access denied - delivery agent only
 */
router.post("/update", authMiddleware, isDispatch, updateLocation);

/**
 * @swagger
 * /location/route:
 *   post:
 *     summary: Get optimized delivery route
 *     description: Get optimized route for delivery using Here Maps
 *     tags:
 *       - Location Tracking
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
 *                 description: Order ID
 *               startLat:
 *                 type: number
 *                 description: Start latitude (optional, uses current location)
 *               startLng:
 *                 type: number
 *                 description: Start longitude (optional, uses current location)
 *     responses:
 *       200:
 *         description: Route calculated successfully
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
 *                     route:
 *                       type: object
 *                       properties:
 *                         distance:
 *                           type: number
 *                         duration:
 *                           type: number
 *                         polyline:
 *                           type: string
 *                         instructions:
 *                           type: array
 *                           items:
 *                             type: object
 *                     waypoints:
 *                       type: array
 *                       items:
 *                         type: array
 *                         items:
 *                           type: number
 *                     estimatedArrival:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid request or no current location
 *       404:
 *         description: Order not found
 */
router.post("/route", authMiddleware, isDispatch, getRoute);

/**
 * @swagger
 * /location/current/{orderId}:
 *   get:
 *     summary: Get current location
 *     description: Get current location of delivery agent for an order
 *     tags:
 *       - Location Tracking
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Current location retrieved successfully
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
 *                     latitude:
 *                       type: number
 *                     longitude:
 *                       type: number
 *                     address:
 *                       type: string
 *                     accuracy:
 *                       type: number
 *                     status:
 *                       type: string
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *       404:
 *         description: No location tracking found
 */
router.get("/current/:orderId", authMiddleware, getCurrentLocation);

/**
 * @swagger
 * /location/history/{orderId}:
 *   get:
 *     summary: Get tracking history
 *     description: Get location tracking history for an order
 *     tags:
 *       - Location Tracking
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of history points to return
 *     responses:
 *       200:
 *         description: Tracking history retrieved successfully
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
 *                     orderId:
 *                       type: string
 *                     status:
 *                       type: string
 *                     history:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           latitude:
 *                             type: number
 *                           longitude:
 *                             type: number
 *                           address:
 *                             type: string
 *                           accuracy:
 *                             type: number
 *                           speed:
 *                             type: number
 *                           heading:
 *                             type: number
 *                           status:
 *                             type: string
 *                           timestamp:
 *                             type: string
 *                             format: date-time
 *                     totalPoints:
 *                       type: number
 *       404:
 *         description: No tracking history found
 */
router.get("/history/:orderId", authMiddleware, getTrackingHistory);

/**
 * @swagger
 * /location/status:
 *   put:
 *     summary: Update delivery status
 *     description: Update delivery status and location
 *     tags:
 *       - Location Tracking
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
 *                 description: Order ID
 *               status:
 *                 type: string
 *                 enum: [assigned, en_route, arrived, delivered, cancelled]
 *                 description: New delivery status
 *               latitude:
 *                 type: number
 *                 description: Current latitude (optional)
 *               longitude:
 *                 type: number
 *                 description: Current longitude (optional)
 *     responses:
 *       200:
 *         description: Status updated successfully
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
 *                     status:
 *                       type: string
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     location:
 *                       type: object
 *       400:
 *         description: Invalid request or status
 *       404:
 *         description: Tracking record not found
 */
router.put("/status", authMiddleware, isDispatch, updateDeliveryStatus);

module.exports = router;
