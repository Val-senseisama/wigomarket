const express = require("express");
const asyncHandler = require("express-async-handler");
const rateLimit = require("express-rate-limit");
const { authMiddleware } = require("../middleware/authMiddleware");
const mapboxService = require("../services/mapboxService");
const { ThrowError } = require("../Helpers/Helpers");

const router = express.Router();

// ─── All maps routes require authentication so the API key is never exposed ───

/**
 * Rate limiter for all maps lookups.
 * Every route here proxies a billed upstream geo request, so an authenticated
 * client hammering autocomplete translates directly into spend.
 * Keyed by user ID so one account cannot exhaust the quota for everyone.
 * 60 lookups per minute per user — comfortably above type-ahead usage.
 */
const mapsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: {
    success: false,
    message: "Too many map lookups. Please slow down and try again shortly.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// authMiddleware runs first so the limiter can key on req.user
router.use(authMiddleware, mapsLimiter);

/**
 * @swagger
 * /api/maps/geocode:
 *   get:
 *     summary: Convert a text address to coordinates
 *     description: Geocodes a Nigerian address string and returns lat/lng + formatted address. Nigeria-scoped.
 *     tags: [Maps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: Full or partial Nigerian address
 *     responses:
 *       200:
 *         description: Geocoding result
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
 *                     lat:
 *                       type: number
 *                     lng:
 *                       type: number
 *                     formattedAddress:
 *                       type: string
 *                     placeId:
 *                       type: string
 */
router.get(
  "/geocode",
  asyncHandler(async (req, res) => {
    const { address } = req.query;

    if (!address || !address.trim()) {
      return res
        .status(400)
        .json({
          success: false,
          message: "address query parameter is required",
        });
    }

    if (!mapboxService.isConfigured()) {
      return res
        .status(503)
        .json({ success: false, message: "Maps service is not configured" });
    }

    const result = await mapboxService.geocodeAddress(address);

    if (!result) {
      return res.status(404).json({
        success: false,
        message:
          "Could not geocode address. Try a more specific Nigerian address.",
      });
    }

    res.json({ success: true, data: result });
  }),
);

/**
 * @swagger
 * /api/maps/reverse-geocode:
 *   get:
 *     summary: Convert coordinates to a human-readable address
 *     tags: [Maps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: lng
 *         required: true
 *         schema:
 *           type: number
 */
router.get(
  "/reverse-geocode",
  asyncHandler(async (req, res) => {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res
        .status(400)
        .json({
          success: false,
          message: "lat and lng query parameters are required",
        });
    }

    if (!mapboxService.isConfigured()) {
      return res
        .status(503)
        .json({ success: false, message: "Maps service is not configured" });
    }

    const result = await mapboxService.reverseGeocode(
      parseFloat(lat),
      parseFloat(lng),
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Could not resolve coordinates to an address.",
      });
    }

    res.json({ success: true, data: result });
  }),
);

/**
 * @swagger
 * /api/maps/places/autocomplete:
 *   get:
 *     summary: Get address suggestions for a partial input (Nigeria only)
 *     tags: [Maps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: input
 *         required: true
 *         schema:
 *           type: string
 *         description: Partial address string
 *       - in: query
 *         name: sessiontoken
 *         required: false
 *         schema:
 *           type: string
 *         description: >
 *           UUID session token. Strongly recommended — Mapbox groups billing for
 *           autocomplete + place details per session, and the returned placeId can
 *           only be resolved by /places/details using this same token.
 */
router.get(
  "/places/autocomplete",
  asyncHandler(async (req, res) => {
    const { input, sessiontoken } = req.query;

    if (!input || !input.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "input query parameter is required" });
    }

    if (!mapboxService.isConfigured()) {
      return res
        .status(503)
        .json({ success: false, message: "Maps service is not configured" });
    }

    const suggestions = await mapboxService.getPlaceAutocomplete(
      input,
      sessiontoken,
    );

    res.json({
      success: true,
      data: suggestions,
      count: suggestions.length,
    });
  }),
);

/**
 * @swagger
 * /api/maps/places/details:
 *   get:
 *     summary: Resolve a placeId from autocomplete to full coordinates
 *     description: >
 *       Resolves a placeId returned by /places/autocomplete. Mapbox scopes a
 *       placeId to the session that produced it, so pass the same sessiontoken
 *       used for the autocomplete call — otherwise the lookup returns 404.
 *     tags: [Maps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: placeId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: sessiontoken
 *         required: false
 *         schema:
 *           type: string
 *         description: The same UUID session token passed to /places/autocomplete
 */
router.get(
  "/places/details",
  asyncHandler(async (req, res) => {
    const { placeId, sessiontoken } = req.query;

    if (!placeId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "placeId query parameter is required",
        });
    }

    if (!mapboxService.isConfigured()) {
      return res
        .status(503)
        .json({ success: false, message: "Maps service is not configured" });
    }

    const result = await mapboxService.getPlaceDetails(placeId, sessiontoken);

    if (!result) {
      return res
        .status(404)
        .json({ success: false, message: "Place not found" });
    }

    res.json({ success: true, data: result });
  }),
);

/**
 * @swagger
 * /api/maps/distance:
 *   get:
 *     summary: Get road distance and drive time between two points
 *     description: Uses the Mapbox Matrix API. Useful for previewing delivery cost before checkout.
 *     tags: [Maps]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: originLat
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: originLng
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: destLat
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: destLng
 *         required: true
 *         schema:
 *           type: number
 */
router.get(
  "/distance",
  asyncHandler(async (req, res) => {
    const { originLat, originLng, destLat, destLng } = req.query;

    if (!originLat || !originLng || !destLat || !destLng) {
      return res.status(400).json({
        success: false,
        message: "originLat, originLng, destLat, destLng are all required",
      });
    }

    if (!mapboxService.isConfigured()) {
      return res
        .status(503)
        .json({ success: false, message: "Maps service is not configured" });
    }

    const result = await mapboxService.getDistanceMatrix(
      { lat: parseFloat(originLat), lng: parseFloat(originLng) },
      { lat: parseFloat(destLat), lng: parseFloat(destLng) },
    );

    if (!result) {
      return res.status(404).json({
        success: false,
        message:
          "Could not calculate distance. Verify the coordinates are valid Nigerian locations.",
      });
    }

    res.json({ success: true, data: result });
  }),
);

module.exports = router;
