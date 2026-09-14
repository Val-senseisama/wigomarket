const asyncHandler = require("express-async-handler");
const LocationTracking = require("../models/locationTrackingModel");
const Geofence = require("../models/geofenceModel");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const DispatchProfile = require("../models/dispatchProfileModel");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");
const redisClient = require("../config/redisClient");
const mapboxService = require("../services/mapboxService");
const { decodePolyline, minDistToPolyline } = require("../utils/routeGeometry");
const { formatDuration } = require("../utils/travelFormat");

// Rider is considered off-route when further than this from the nearest point
// on the route line. 50 m works well in urban areas.
const DEVIATION_THRESHOLD_METERS = 50;

// The ping's reported GPS accuracy is added on top of the threshold so city
// GPS noise doesn't trigger reroutes — capped so a wildly bad fix can't
// suppress rerouting altogether.
const MAX_GPS_ACCURACY_ALLOWANCE_METERS = 50;

// How long to cache an order's pickup + dropoff coords in Redis.
// These never change once an order is placed, so a long TTL is safe.
const ORDER_COORDS_TTL = 86_400; // 24 hours in seconds

/**
 * @function updateLocation
 * @description Update delivery agent's current location
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {number} req.body.latitude - Current latitude
 * @param {number} req.body.longitude - Current longitude
 * @param {string} req.body.orderId - Order ID being delivered
 * @param {number} [req.body.accuracy] - Location accuracy in meters
 * @param {number} [req.body.speed] - Current speed in km/h
 * @param {number} [req.body.heading] - Current heading in degrees
 * @returns {Object} - Location update response
 */
const updateLocation = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const {
    latitude,
    longitude,
    orderId,
    accuracy = 10,
    speed,
    heading,
  } = req.body;

  // Validate input
  if (!latitude || !longitude || !orderId) {
    return res.status(400).json({
      success: false,
      message: "Latitude, longitude, and orderId are required",
    });
  }

  if (!Validate.float(latitude) || !Validate.float(longitude)) {
    return res.status(400).json({
      success: false,
      message: "Invalid latitude or longitude values",
    });
  }

  validateMongodbId(orderId);

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update location.",
    });
  }

  try {
    // Get reverse geocoding address
    const address = await getAddressFromCoordinates(latitude, longitude);

    // Find or create location tracking record
    let tracking = await LocationTracking.findOne({
      deliveryAgent: _id,
      order: orderId,
      isActive: true,
    });

    if (!tracking) {
      // Create new tracking record
      tracking = await LocationTracking.create({
        deliveryAgent: _id,
        order: orderId,
        currentLocation: {
          type: "Point",
          coordinates: [longitude, latitude],
          address: address,
          accuracy: accuracy,
          timestamp: new Date(),
        },
        status: "assigned",
      });
    } else {
      // Update existing tracking record
      const newLocation = {
        type: "Point",
        coordinates: [longitude, latitude],
        address: address,
        accuracy: accuracy,
        timestamp: new Date(),
      };

      // Add to tracking history
      tracking.trackingHistory.push({
        location: newLocation,
        timestamp: new Date(),
        accuracy: accuracy,
        speed: speed,
        heading: heading,
        status: tracking.status,
      });

      // Update current location
      tracking.currentLocation = newLocation;
      tracking.lastUpdated = new Date();

      await tracking.save();
    }

    // Check geofences
    await checkGeofences(tracking, latitude, longitude);

    // ── ETA refresh + deviation-triggered reroute ─────────────────────────
    // Non-blocking: a failure here must never break the location ping itself.
    const { etaSeconds, etaText, nextStop, rerouted, route: newRoute } =
      await refreshEtaAndRoute(tracking, latitude, longitude, accuracy).catch((err) => {
        console.warn("[updateLocation] ETA/reroute error:", err.message);
        return {};
      });

    // Cache location for real-time updates
    await redisClient.setex(
      `location:${_id}:${orderId}`,
      300, // 5 minutes TTL
      JSON.stringify({
        latitude,
        longitude,
        address,
        timestamp: new Date(),
        status: tracking.status,
        etaSeconds: etaSeconds ?? null,
        nextStop: nextStop ?? null,
      }),
    );

    // Publish location update to WebSocket clients.
    // Includes ETA on every ping; includes new route polyline when rerouted.
    await publishLocationUpdate(_id, orderId, {
      latitude,
      longitude,
      address,
      status: tracking.status,
      timestamp: new Date(),
      etaSeconds: etaSeconds ?? null,
      etaText: etaText ?? null,
      nextStop: nextStop ?? null,
      rerouted: rerouted ?? false,
      ...(newRoute ? { route: newRoute } : {}),
    });

    res.json({
      success: true,
      message: "Location updated successfully",
      data: {
        location: {
          latitude,
          longitude,
          address,
          accuracy,
          timestamp: new Date(),
        },
        status: tracking.status,
        eta: {
          seconds: etaSeconds ?? null,
          text: etaText ?? null,
        },
        nextStop: nextStop ?? null,
        rerouted: rerouted ?? false,
        ...(newRoute ? { route: newRoute } : {}),
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Location update failed");
  }
});

/**
 * @function getRoute
 * @description Get optimized route for delivery
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {string} req.body.orderId - Order ID
 * @param {number} [req.body.startLat] - Start latitude (optional, uses current location)
 * @param {number} [req.body.startLng] - Start longitude (optional, uses current location)
 * @returns {Object} - Route information
 */
const getRoute = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { orderId, startLat, startLng } = req.body;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  validateMongodbId(orderId);

  try {
    // Get order details
    const order = await Order.findById(orderId)
      .populate("products.store", "name address")
      .populate("orderedBy", "fullName mobile");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Get delivery addresses
    const deliveryAddress = order.deliveryAddress;
    // Route through the stores only while the order still needs collecting —
    // after pickup the rider heads straight to the dropoff. De-duplicated so a
    // multi-item order from one store doesn't add the same stop repeatedly.
    const storeAddresses =
      order.deliveryStatus === "assigned"
        ? [
            ...new Set(
              order.products.map((item) => item.store?.address).filter(Boolean),
            ),
          ]
        : [];

    // Use current location or provided start coordinates
    let startCoordinates;
    if (startLat && startLng) {
      startCoordinates = [startLng, startLat];
    } else {
      // Get current location from tracking
      const tracking = await LocationTracking.findOne({
        deliveryAgent: _id,
        order: orderId,
        isActive: true,
      });

      if (tracking) {
        startCoordinates = tracking.currentLocation.coordinates;
      } else {
        return res.status(400).json({
          success: false,
          message:
            "No current location found. Please update your location first.",
        });
      }
    }

    // Get geocoded coordinates for addresses
    const deliveryCoords = await getCoordinatesFromAddress(deliveryAddress);
    const storeCoords = await Promise.all(
      storeAddresses.map((addr) => getCoordinatesFromAddress(addr)),
    );

    // Build waypoints
    const waypoints = [...storeCoords.filter((coord) => coord), deliveryCoords];

    // Get optimized route from Here Maps
    const route = await getOptimizedRoute(startCoordinates, waypoints);

    // Update tracking with route information
    await LocationTracking.findOneAndUpdate(
      { deliveryAgent: _id, order: orderId, isActive: true },
      {
        route: {
          startLocation: {
            type: "Point",
            coordinates: startCoordinates,
            address: await getAddressFromCoordinates(
              startCoordinates[1],
              startCoordinates[0],
            ),
          },
          endLocation: {
            type: "Point",
            coordinates: deliveryCoords,
            address: deliveryAddress,
          },
          waypoints: waypoints.map((coord, index) => ({
            type: "Point",
            coordinates: coord,
            address: storeAddresses[index] || deliveryAddress,
            order: index,
          })),
          optimizedRoute: route,
          estimatedArrival: new Date(Date.now() + route.duration * 1000),
        },
      },
    );

    res.json({
      success: true,
      data: {
        route: route,
        waypoints: waypoints,
        estimatedArrival: new Date(Date.now() + route.duration * 1000),
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Route calculation failed");
  }
});

/**
 * @function getCurrentLocation
 * @description Get current location of delivery agent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.orderId - Order ID
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Current location information
 */
const getCurrentLocation = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { _id } = req.user;

  validateMongodbId(orderId);

  try {
    // Try to get from cache first
    const cachedLocation = await redisClient.get(`location:${_id}:${orderId}`);
    if (cachedLocation) {
      return res.json({
        success: true,
        data: JSON.parse(cachedLocation),
      });
    }

    // Get from database
    const tracking = await LocationTracking.findOne({
      deliveryAgent: _id,
      order: orderId,
      isActive: true,
    }).select("currentLocation status lastUpdated");

    if (!tracking) {
      return res.status(404).json({
        success: false,
        message: "No location tracking found for this order",
      });
    }

    const locationData = {
      latitude: tracking.currentLocation.coordinates[1],
      longitude: tracking.currentLocation.coordinates[0],
      address: tracking.currentLocation.address,
      accuracy: tracking.currentLocation.accuracy,
      status: tracking.status,
      timestamp: tracking.currentLocation.timestamp,
      lastUpdated: tracking.lastUpdated,
    };

    res.json({
      success: true,
      data: locationData,
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get current location");
  }
});

/**
 * @function getTrackingHistory
 * @description Get location tracking history for an order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.orderId - Order ID
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} [req.query.limit=50] - Number of history points to return
 * @returns {Object} - Tracking history
 */
const getTrackingHistory = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { _id } = req.user;
  const { limit = 50 } = req.query;

  validateMongodbId(orderId);

  try {
    const tracking = await LocationTracking.findOne({
      deliveryAgent: _id,
      order: orderId,
      isActive: true,
    }).select("trackingHistory status");

    if (!tracking) {
      return res.status(404).json({
        success: false,
        message: "No tracking history found for this order",
      });
    }

    // Get recent history points
    const history = tracking.trackingHistory
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit))
      .map((point) => ({
        latitude: point.location.coordinates[1],
        longitude: point.location.coordinates[0],
        address: point.location.address,
        accuracy: point.accuracy,
        speed: point.speed,
        heading: point.heading,
        status: point.status,
        timestamp: point.timestamp,
      }));

    res.json({
      success: true,
      data: {
        orderId: orderId,
        status: tracking.status,
        history: history,
        totalPoints: tracking.trackingHistory.length,
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get tracking history");
  }
});

/**
 * @function updateDeliveryStatus
 * @description Update the live-tracking record's own status (the map/journey
 *              state) and optionally stamp the rider's current position.
 *
 *              This updates LocationTracking ONLY — it is not the order
 *              lifecycle. The order's deliveryStatus is owned by
 *              PUT /api/delivery-agent/orders/status (assigned → picked_up →
 *              in_transit), and "delivered" is owned exclusively by the
 *              dual-confirm flow in dispatchEarningsService, which is what
 *              credits the rider's wallet. Marking an order delivered from
 *              here used to bypass both, permanently stranding the rider's
 *              earnings, so "delivered" is not accepted on this endpoint.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {string} req.body.orderId - Order ID
 * @param {string} req.body.status - New tracking status (en_route | arrived | assigned | cancelled)
 * @param {number} [req.body.latitude] - Current latitude
 * @param {number} [req.body.longitude] - Current longitude
 * @returns {Object} - Status update response
 */
const updateDeliveryStatus = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { orderId, status, latitude, longitude } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({
      success: false,
      message: "Order ID and status are required",
    });
  }

  // "delivered" is intentionally absent — it belongs to the dual-confirm flow,
  // which is the only path that credits the rider's wallet. See the note above.
  const validStatuses = ["assigned", "en_route", "arrived", "cancelled"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid status. Must be one of: " +
        validStatuses.join(", ") +
        (status === "delivered"
          ? ". Use POST /api/delivery-agent/orders/confirm-delivery to mark as delivered."
          : ""),
    });
  }

  validateMongodbId(orderId);

  try {
    const updateData = { status, lastUpdated: new Date() };

    // If location is provided, update it
    if (latitude && longitude) {
      const address = await getAddressFromCoordinates(latitude, longitude);
      updateData.currentLocation = {
        type: "Point",
        coordinates: [longitude, latitude],
        address: address,
        timestamp: new Date(),
      };

      // Add to tracking history
      updateData.$push = {
        trackingHistory: {
          location: updateData.currentLocation,
          timestamp: new Date(),
          status: status,
        },
      };
    }

    const tracking = await LocationTracking.findOneAndUpdate(
      { deliveryAgent: _id, order: orderId, isActive: true },
      updateData,
      { new: true },
    );

    if (!tracking) {
      return res.status(404).json({
        success: false,
        message: "Tracking record not found",
      });
    }

    res.json({
      success: true,
      message: `Delivery status updated to ${status}`,
      data: {
        status: status,
        timestamp: new Date(),
        location: tracking.currentLocation,
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Status update failed");
  }
});

// ─── Map Helper Functions (Mapbox) ─────────────────────────────────────

/**
 * Reverse-geocode coordinates to a human-readable address.
 * Falls back to a "lat, lng" string if API is unavailable.
 */
async function getAddressFromCoordinates(latitude, longitude) {
  try {
    const result = await mapboxService.reverseGeocode(
      parseFloat(latitude),
      parseFloat(longitude),
    );
    return result?.formattedAddress || `${latitude}, ${longitude}`;
  } catch (error) {
    console.log("[Maps] reverseGeocode error:", error.message);
    return `${latitude}, ${longitude}`;
  }
}

/**
 * Geocode a text address to [longitude, latitude] coordinates.
 * Returns null if geocoding fails.
 */
async function getCoordinatesFromAddress(address) {
  try {
    const result = await mapboxService.geocodeAddress(address);
    if (!result) return null;
    return [result.lng, result.lat]; // GeoJSON order: [lng, lat]
  } catch (error) {
    console.log("[Maps] geocode error:", error.message);
    return null;
  }
}

/**
 * Get an optimised driving route with optional waypoints.
 * @param {[number,number]} start      - [lng, lat]
 * @param {Array<[number,number]>} waypoints - array of [lng, lat]
 * @returns {Promise<{distance,duration,polyline,instructions}>}
 */
async function getOptimizedRoute(start, waypoints) {
  // Convert GeoJSON [lng, lat] arrays to {lat, lng} objects
  const originCoords = { lat: start[1], lng: start[0] };
  const destCoords = { lat: waypoints.at(-1)[1], lng: waypoints.at(-1)[0] };
  const midWayCoords = waypoints
    .slice(0, -1)
    .map((wp) => ({ lat: wp[1], lng: wp[0] }));

  const result = await mapboxService.getDirections(
    originCoords,
    destCoords,
    midWayCoords,
  );

  if (!result) throw new Error("No route found");

  return {
    distance: result.distance, // metres
    duration: result.duration, // seconds
    polyline: result.polyline,
    instructions: result.steps.map((s) => ({
      instruction: s.instruction,
      distance: s.distance,
      duration: s.duration,
      coordinates: [s.startLocation.lng, s.startLocation.lat],
    })),
  };
}

/**
 * Check geofences and trigger notifications
 */
async function checkGeofences(tracking, latitude, longitude) {
  try {
    const geofences = await Geofence.find({
      status: "active",
      "center.coordinates": {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          $maxDistance: 5000, // 5km radius
        },
      },
    });

    for (const geofence of geofences) {
      const isInside = geofence.isPointInside(longitude, latitude);
      const wasInside = tracking.geofences.find(
        (gf) => gf.name === geofence.name,
      );

      if (isInside && !wasInside) {
        // Entered geofence
        tracking.geofences.push({
          name: geofence.name,
          type: geofence.type,
          center: geofence.center,
          radius: geofence.radius,
          enteredAt: new Date(),
        });

        tracking.notifications.push({
          type: "geofence_enter",
          message: `Entered ${geofence.name}`,
          timestamp: new Date(),
        });
      } else if (!isInside && wasInside) {
        // Exited geofence
        const geofenceIndex = tracking.geofences.findIndex(
          (gf) => gf.name === geofence.name,
        );
        if (geofenceIndex !== -1) {
          tracking.geofences[geofenceIndex].exitedAt = new Date();
        }

        tracking.notifications.push({
          type: "geofence_exit",
          message: `Exited ${geofence.name}`,
          timestamp: new Date(),
        });
      }
    }

    await tracking.save();
  } catch (error) {
    console.log("Geofence check error:", error.message);
  }
}

/**
 * Publish location update to WebSocket clients
 */
async function publishLocationUpdate(deliveryAgentId, orderId, locationData) {
  try {
    await redisClient.publish(
      "location_updates",
      JSON.stringify({
        deliveryAgentId,
        orderId,
        location: locationData,
        timestamp: new Date(),
      }),
    );
  } catch (error) {
    console.log("WebSocket publish error:", error.message);
  }
}

// ─── ETA + Rerouting Helpers ────────────────────────────────────────────────

/**
 * Fetch (and Redis-cache) the pickup + dropoff coordinates for an order so
 * every location ping avoids a full Mongo populate.
 * Dropoff = order.deliveryLocation GeoJSON; pickup = first store with a location.
 * Either coord may be null if the order was saved without geocoding.
 */
async function getOrderCoords(orderId) {
  const cacheKey = `order_coords:${orderId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (_) {}

  const order = await Order.findById(orderId)
    .populate("products.store", "address location")
    .select("deliveryAddress deliveryLocation products");

  if (!order) return null;

  let dropoffLat = null, dropoffLng = null;
  if (order.deliveryLocation?.coordinates?.length === 2) {
    [dropoffLng, dropoffLat] = order.deliveryLocation.coordinates; // GeoJSON: [lng, lat]
  }

  let pickupLat = null, pickupLng = null;
  for (const line of order.products || []) {
    const store = line.store && typeof line.store === "object" ? line.store : null;
    if (store?.location?.coordinates?.length === 2) {
      [pickupLng, pickupLat] = store.location.coordinates;
      break;
    }
  }

  const coords = { pickupLat, pickupLng, dropoffLat, dropoffLng };
  try {
    await redisClient.setex(cacheKey, ORDER_COORDS_TTL, JSON.stringify(coords));
  } catch (_) {}
  return coords;
}

/**
 * Duration (seconds) of the store → dropoff leg. Both ends are fixed once the
 * order is placed, so this is cached: one Matrix call per order rather than
 * one per ping. Failures are not cached, so the next ping retries.
 */
async function getPickupToDropoffSeconds(orderId, pickup, dropoff) {
  const cacheKey = `order_leg:${orderId}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached != null) return Number(cached);
  } catch (_) {}

  const leg = await mapboxService.getDistanceMatrix(pickup, dropoff);
  if (!leg) return null;

  try {
    await redisClient.setex(cacheKey, ORDER_COORDS_TTL, String(leg.durationSeconds));
  } catch (_) {}
  return leg.durationSeconds;
}

/**
 * Called after every successful location ping.
 *
 * Step 1 — Leg: reads the order's live deliveryStatus. While it is still
 *   "assigned" the rider has yet to collect from the store, so the store is
 *   the next stop. This deliberately reads the Order rather than
 *   tracking.status: tracking.status only moves when the client calls
 *   PUT /api/location/status, which the order flow does not require, so
 *   gating on it kept routing riders back through the store after pickup.
 *
 * Step 2 — ETA refresh: Mapbox Matrix from the rider to the dropoff — or, while
 *   pickup is pending, to the store plus the cached store → dropoff leg.
 *
 * Step 3 — Deviation detection: distance from the rider to the nearest point
 *   on the stored route line. Within DEVIATION_THRESHOLD_METERS plus the
 *   ping's GPS accuracy (capped), we're done.
 *
 * Step 4 — Reroute: otherwise, or when no route is stored yet, Mapbox
 *   Directions plans a new route from the rider's position — through the
 *   store only while pickup is pending. It is persisted as the new baseline
 *   and returned with rerouted: true so the client can swap its polyline.
 *
 * Mapbox failures degrade to a null ETA / no reroute rather than throwing;
 * the caller still guards against unexpected errors.
 */
async function refreshEtaAndRoute(tracking, riderLat, riderLng, accuracy) {
  const result = {
    etaSeconds: null,
    etaText: null,
    nextStop: null,
    rerouted: false,
    route: null,
  };

  const orderId = tracking.order.toString();
  const coords = await getOrderCoords(orderId);
  if (!coords || coords.dropoffLat == null || coords.dropoffLng == null) {
    return result; // no dropoff coords — nothing to compute
  }

  // ── 1. Which leg is the rider on? ────────────────────────────────────────
  // Read fresh on every ping rather than from the coords cache: it changes
  // mid-delivery.
  const order = await Order.findById(orderId).select("deliveryStatus").lean();
  const pickupPending = order?.deliveryStatus === "assigned";
  result.nextStop = pickupPending ? "pickup" : "dropoff";

  if (pickupPending && (coords.pickupLat == null || coords.pickupLng == null)) {
    // Store never geocoded: any ETA or route would skip the pickup and read
    // as a falsely early arrival, so report the leg and nothing else.
    return result;
  }

  const rider = { lat: riderLat, lng: riderLng };
  const pickup = { lat: coords.pickupLat, lng: coords.pickupLng };
  const dropoff = { lat: coords.dropoffLat, lng: coords.dropoffLng };

  // ── 2. Fresh ETA ─────────────────────────────────────────────────────────
  if (pickupPending) {
    const [toStore, storeToDropoff] = await Promise.all([
      mapboxService.getDistanceMatrix(rider, pickup),
      getPickupToDropoffSeconds(orderId, pickup, dropoff),
    ]);
    // Only report an ETA when both legs are known — one leg alone would read
    // as an early arrival.
    if (toStore && storeToDropoff != null) {
      result.etaSeconds = toStore.durationSeconds + storeToDropoff;
    }
  } else {
    const matrix = await mapboxService.getDistanceMatrix(rider, dropoff);
    if (matrix) result.etaSeconds = matrix.durationSeconds;
  }
  if (result.etaSeconds != null) {
    result.etaText = formatDuration(result.etaSeconds);
  }

  // ── 3. Deviation detection ───────────────────────────────────────────────
  const storedPolyline = tracking.route?.optimizedRoute?.polyline;
  if (storedPolyline) {
    try {
      const offRoute = minDistToPolyline(
        riderLat,
        riderLng,
        decodePolyline(storedPolyline),
      );
      const tolerance =
        DEVIATION_THRESHOLD_METERS +
        Math.min(Number(accuracy) || 0, MAX_GPS_ACCURACY_ALLOWANCE_METERS);
      if (offRoute <= tolerance) return result; // on route — done
      console.log(
        `[reroute] Rider is ${Math.round(offRoute)}m off route ` +
          `(tolerance ${Math.round(tolerance)}m) — recalculating`,
      );
    } catch (_) {
      // corrupt polyline — fall through to reroute
    }
  }

  // ── 4. Reroute ───────────────────────────────────────────────────────────
  const newRoute = await mapboxService.getDirections(
    rider,
    dropoff,
    pickupPending ? [pickup] : [],
  );

  if (!newRoute) return result; // Mapbox unavailable — keep the matrix ETA

  const estimatedArrival = new Date(Date.now() + newRoute.duration * 1000);
  const steps = newRoute.steps || [];
  result.rerouted = true;
  // Directions follows the actual road route (via the store while pending),
  // so it supersedes the matrix estimate.
  result.etaSeconds = newRoute.duration;
  result.etaText = formatDuration(newRoute.duration);
  result.route = {
    polyline: newRoute.polyline,
    distance: newRoute.distance,
    duration: newRoute.duration,
    steps,
    estimatedArrival,
  };

  // Persist the recalculated route so future pings use it as the baseline.
  await LocationTracking.findByIdAndUpdate(tracking._id, {
    "route.optimizedRoute": {
      polyline: newRoute.polyline,
      distance: newRoute.distance,
      duration: newRoute.duration,
      // The schema stores `instructions` (the shape getRoute persists); a
      // `steps` key here was silently dropped by strict mode.
      instructions: steps.map((step) => ({
        instruction: step.instruction,
        distance: step.distance,
        duration: step.duration,
        coordinates: [step.startLocation.lng, step.startLocation.lat],
      })),
    },
    "route.estimatedArrival": estimatedArrival,
  });

  return result;
}

module.exports = {
  updateLocation,
  getRoute,
  getCurrentLocation,
  getTrackingHistory,
  updateDeliveryStatus,
};
