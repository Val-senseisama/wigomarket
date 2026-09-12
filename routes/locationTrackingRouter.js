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
 * /api/location/update:
 *   post:
 *     summary: Update delivery agent location
 *     description: |
 *       Push the rider's current GPS position. On every call the server:
 *       1. Persists the position to `LocationTracking` and the breadcrumb history.
 *       2. Checks geofences.
 *       3. Calculates a **fresh ETA** (Mapbox Matrix API: current pos → dropoff).
 *       4. Runs **deviation detection** — decodes the stored route polyline and
 *          measures the nearest vertex distance. If the rider is more than 50 m
 *          off-route (or no route has been calculated yet), a new route is
 *          requested from Mapbox Directions and the response includes the full
 *          `route` object with `rerouted: true`.
 *
 *       The same payload is broadcast to WebSocket subscribers on the
 *       `location_updates` Redis channel so the customer tracking screen
 *       updates in real time.
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
 *                 example: 6.5244
 *               longitude:
 *                 type: number
 *                 description: Current longitude
 *                 example: 3.3792
 *               orderId:
 *                 type: string
 *                 description: Mongo _id of the order being delivered
 *               accuracy:
 *                 type: number
 *                 description: GPS accuracy in metres (default 10)
 *               speed:
 *                 type: number
 *                 description: Current speed in km/h
 *               heading:
 *                 type: number
 *                 description: Current heading in degrees (0–360)
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
 *                           description: Reverse-geocoded street address
 *                         accuracy:
 *                           type: number
 *                         timestamp:
 *                           type: string
 *                           format: date-time
 *                     status:
 *                       type: string
 *                       description: Current tracking status (e.g. in_transit)
 *                     eta:
 *                       type: object
 *                       description: >
 *                         Live ETA from the rider's current position to the
 *                         dropoff, recalculated on every ping.
 *                       properties:
 *                         seconds:
 *                           type: integer
 *                           nullable: true
 *                           description: Remaining travel time in seconds
 *                           example: 480
 *                         text:
 *                           type: string
 *                           nullable: true
 *                           description: Human-readable ETA (e.g. "8 mins")
 *                           example: "8 mins"
 *                     rerouted:
 *                       type: boolean
 *                       description: >
 *                         True when the rider deviated more than 50 m from the
 *                         stored route and a new route was calculated. The
 *                         frontend should swap its displayed polyline whenever
 *                         this is true.
 *                       example: false
 *                     route:
 *                       type: object
 *                       nullable: true
 *                       description: >
 *                         Only present when `rerouted` is true. Contains the
 *                         recalculated route from the rider's current position.
 *                       properties:
 *                         polyline:
 *                           type: string
 *                           description: Precision-5 encoded polyline string
 *                         distance:
 *                           type: number
 *                           description: Total route distance in metres
 *                         duration:
 *                           type: number
 *                           description: Total route duration in seconds
 *                         steps:
 *                           type: array
 *                           description: Turn-by-turn instruction steps
 *                           items:
 *                             type: object
 *                             properties:
 *                               instruction:
 *                                 type: string
 *                               distance:
 *                                 type: number
 *                               duration:
 *                                 type: number
 *                               startLocation:
 *                                 type: object
 *                                 properties:
 *                                   lat:
 *                                     type: number
 *                                   lng:
 *                                     type: number
 *                         estimatedArrival:
 *                           type: string
 *                           format: date-time
 *                           description: Absolute arrival timestamp
 *       400:
 *         description: Missing or invalid latitude / longitude / orderId
 *       403:
 *         description: Access denied — delivery agents only
 */
router.post("/update", authMiddleware, isDispatch, updateLocation);

/**
 * @swagger
 * /api/location/route:
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
 * /api/location/current/{orderId}:
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
 * /api/location/history/{orderId}:
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
 * /api/location/status:
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
