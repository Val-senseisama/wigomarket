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
 *       3. Calculates a **fresh ETA to the dropoff**. While the order's
 *          `deliveryStatus` is still `assigned` (not yet picked up), the ETA
 *          goes rider → store → dropoff and `nextStop` is `pickup`. Once the
 *          rider sends `picked_up` to `PUT /api/delivery-agent/orders/status`,
 *          it is measured rider → dropoff and `nextStop` is `dropoff`.
 *       4. Runs **deviation detection** — measures the distance from the rider
 *          to the nearest point on the stored route line. The rider is
 *          off-route beyond 50 m plus the reported GPS `accuracy` (the
 *          accuracy allowance is capped at 50 m). When off-route, or when no
 *          route exists yet, Mapbox Directions plans a new route (through the
 *          store only while pickup is still pending) and the response carries
 *          it as `route` with `rerouted: true`.
 *
 *       The same fields are broadcast to WebSocket subscribers of the order,
 *       nested under the message's `location` object, with the position as
 *       `location.latitude` / `location.longitude`.
 *
 *       Send roughly every 10 s while the rider is moving; every ping makes
 *       billed Mapbox calls.
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
 *                         Live ETA to the dropoff, recalculated on every ping —
 *                         via the store while `nextStop` is `pickup`. Both
 *                         fields are null when the order has no dropoff
 *                         coordinates or Mapbox failed on this ping; clients
 *                         should keep the last value shown.
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
 *                     nextStop:
 *                       type: string
 *                       nullable: true
 *                       enum: [pickup, dropoff]
 *                       description: >
 *                         Where the rider is heading now. `pickup` until the
 *                         order's deliveryStatus leaves `assigned`, then
 *                         `dropoff`. Null only when the order has no dropoff
 *                         coordinates.
 *                       example: dropoff
 *                     rerouted:
 *                       type: boolean
 *                       description: >
 *                         True when the rider left the stored route (50 m plus
 *                         GPS accuracy, capped at 50 m extra) or no route
 *                         existed yet, and a new one was calculated. The
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
 *     summary: Update the live-tracking record's status (NOT the order status)
 *     description: |
 *       Updates the **tracking record** that backs the live map — the journey
 *       state the rider is in — and optionally stamps their current position.
 *
 *       This is **not** the order lifecycle, and does not duplicate
 *       `PUT /api/delivery-agent/orders/status`. The two write different
 *       collections with non-overlapping vocabularies:
 *
 *       | | this endpoint | `/delivery-agent/orders/status` |
 *       |---|---|---|
 *       | writes | `LocationTracking` | `Order` |
 *       | statuses | `assigned, en_route, arrived, cancelled` | `assigned, picked_up, in_transit, failed` |
 *
 *       **`delivered` is not accepted here.** Marking an order delivered is
 *       owned exclusively by the dual-confirm flow
 *       (`POST /api/delivery-agent/orders/confirm-delivery` for the rider,
 *       `POST /api/order/confirm-delivery` for the customer), which is the only
 *       path that credits the rider's wallet. Sending `delivered` returns 400.
 *
 *       Requires an active tracking record for the order (created by
 *       `POST /api/location/update`); returns 404 otherwise.
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
 *                 enum: [assigned, en_route, arrived, cancelled]
 *                 description: >
 *                   New tracking status. `delivered` is rejected with 400 — use
 *                   the confirm-delivery flow instead.
 *               latitude:
 *                 type: number
 *                 description: Current latitude (optional; sent with longitude to stamp position)
 *               longitude:
 *                 type: number
 *                 description: Current longitude (optional; sent with latitude to stamp position)
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
 *         description: Missing orderId/status, or an invalid status (including `delivered`)
 *       404:
 *         description: No active tracking record for this order and rider
 */
router.put("/status", authMiddleware, isDispatch, updateDeliveryStatus);

module.exports = router;
