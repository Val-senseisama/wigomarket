const asyncHandler = require("express-async-handler");
const LocationTracking = require("../models/locationTrackingModel");
const Geofence = require("../models/geofenceModel");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const DispatchProfile = require("../models/dispatchProfileModel");
const { validateMongodbId } = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");
const axios = require("axios");
const Redis = require("ioredis");

// Redis client for real-time location caching
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

// Here Maps API configuration
const HERE_API_KEY = process.env.HERE_API_KEY;
const HERE_APP_ID = process.env.HERE_APP_CODE;
const HERE_BASE_URL = "https://api.here.com";

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
  const { latitude, longitude, orderId, accuracy = 10, speed, heading } = req.body;
  
  // Validate input
  if (!latitude || !longitude || !orderId) {
    return res.status(400).json({
      success: false,
      message: "Latitude, longitude, and orderId are required"
    });
  }
  
  if (!Validate.float(latitude) || !Validate.float(longitude)) {
    return res.status(400).json({
      success: false,
      message: "Invalid latitude or longitude values"
    });
  }
  
  validateMongodbId(orderId);
  
  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update location."
    });
  }
  
  try {
    // Get reverse geocoding address
    const address = await getAddressFromCoordinates(latitude, longitude);
    
    // Find or create location tracking record
    let tracking = await LocationTracking.findOne({
      deliveryAgent: _id,
      order: orderId,
      isActive: true
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
          timestamp: new Date()
        },
        status: "assigned"
      });
    } else {
      // Update existing tracking record
      const newLocation = {
        type: "Point",
        coordinates: [longitude, latitude],
        address: address,
        accuracy: accuracy,
        timestamp: new Date()
      };
      
      // Add to tracking history
      tracking.trackingHistory.push({
        location: newLocation,
        timestamp: new Date(),
        accuracy: accuracy,
        speed: speed,
        heading: heading,
        status: tracking.status
      });
      
      // Update current location
      tracking.currentLocation = newLocation;
      tracking.lastUpdated = new Date();
      
      await tracking.save();
    }
    
    // Check geofences
    await checkGeofences(tracking, latitude, longitude);
    
    // Cache location for real-time updates
    await redisClient.setex(
      `location:${_id}:${orderId}`,
      300, // 5 minutes TTL
      JSON.stringify({
        latitude,
        longitude,
        address,
        timestamp: new Date(),
        status: tracking.status
      })
    );
    
    // Publish location update to WebSocket clients
    await publishLocationUpdate(_id, orderId, {
      latitude,
      longitude,
      address,
      status: tracking.status,
      timestamp: new Date()
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
          timestamp: new Date()
        },
        status: tracking.status
      }
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
      message: "Order ID is required"
    });
  }
  
  validateMongodbId(orderId);
  
  try {
    // Get order details
    const order = await Order.findById(orderId)
      .populate('products.store', 'name address')
      .populate('orderedBy', 'fullName mobile');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }
    
    // Get delivery addresses
    const deliveryAddress = order.deliveryAddress;
    const storeAddresses = order.products.map(item => item.store.address);
    
    // Use current location or provided start coordinates
    let startCoordinates;
    if (startLat && startLng) {
      startCoordinates = [startLng, startLat];
    } else {
      // Get current location from tracking
      const tracking = await LocationTracking.findOne({
        deliveryAgent: _id,
        order: orderId,
        isActive: true
      });
      
      if (tracking) {
        startCoordinates = tracking.currentLocation.coordinates;
      } else {
        return res.status(400).json({
          success: false,
          message: "No current location found. Please update your location first."
        });
      }
    }
    
    // Get geocoded coordinates for addresses
    const deliveryCoords = await getCoordinatesFromAddress(deliveryAddress);
    const storeCoords = await Promise.all(
      storeAddresses.map(addr => getCoordinatesFromAddress(addr))
    );
    
    // Build waypoints
    const waypoints = [
      ...storeCoords.filter(coord => coord),
      deliveryCoords
    ];
    
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
            address: await getAddressFromCoordinates(startCoordinates[1], startCoordinates[0])
          },
          endLocation: {
            type: "Point",
            coordinates: deliveryCoords,
            address: deliveryAddress
          },
          waypoints: waypoints.map((coord, index) => ({
            type: "Point",
            coordinates: coord,
            address: storeAddresses[index] || deliveryAddress,
            order: index
          })),
          optimizedRoute: route,
          estimatedArrival: new Date(Date.now() + route.duration * 1000)
        }
      }
    );
    
    res.json({
      success: true,
      data: {
        route: route,
        waypoints: waypoints,
        estimatedArrival: new Date(Date.now() + route.duration * 1000)
      }
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
        data: JSON.parse(cachedLocation)
      });
    }
    
    // Get from database
    const tracking = await LocationTracking.findOne({
      deliveryAgent: _id,
      order: orderId,
      isActive: true
    }).select('currentLocation status lastUpdated');
    
    if (!tracking) {
      return res.status(404).json({
        success: false,
        message: "No location tracking found for this order"
      });
    }
    
    const locationData = {
      latitude: tracking.currentLocation.coordinates[1],
      longitude: tracking.currentLocation.coordinates[0],
      address: tracking.currentLocation.address,
      accuracy: tracking.currentLocation.accuracy,
      status: tracking.status,
      timestamp: tracking.currentLocation.timestamp,
      lastUpdated: tracking.lastUpdated
    };
    
    res.json({
      success: true,
      data: locationData
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
      isActive: true
    }).select('trackingHistory status');
    
    if (!tracking) {
      return res.status(404).json({
        success: false,
        message: "No tracking history found for this order"
      });
    }
    
    // Get recent history points
    const history = tracking.trackingHistory
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, parseInt(limit))
      .map(point => ({
        latitude: point.location.coordinates[1],
        longitude: point.location.coordinates[0],
        address: point.location.address,
        accuracy: point.accuracy,
        speed: point.speed,
        heading: point.heading,
        status: point.status,
        timestamp: point.timestamp
      }));
    
    res.json({
      success: true,
      data: {
        orderId: orderId,
        status: tracking.status,
        history: history,
        totalPoints: tracking.trackingHistory.length
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get tracking history");
  }
});

/**
 * @function updateDeliveryStatus
 * @description Update delivery status and location
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated delivery agent's ID
 * @param {string} req.body.orderId - Order ID
 * @param {string} req.body.status - New delivery status
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
      message: "Order ID and status are required"
    });
  }
  
  const validStatuses = ["assigned", "en_route", "arrived", "delivered", "cancelled"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status. Must be one of: " + validStatuses.join(", ")
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
        timestamp: new Date()
      };
      
      // Add to tracking history
      updateData.$push = {
        trackingHistory: {
          location: updateData.currentLocation,
          timestamp: new Date(),
          status: status
        }
      };
    }
    
    const tracking = await LocationTracking.findOneAndUpdate(
      { deliveryAgent: _id, order: orderId, isActive: true },
      updateData,
      { new: true }
    );
    
    if (!tracking) {
      return res.status(404).json({
        success: false,
        message: "Tracking record not found"
      });
    }
    
    // Update order status if delivered
    if (status === "delivered") {
      await Order.findByIdAndUpdate(orderId, {
        deliveryStatus: "delivered",
        orderStatus: "Filled",
        actualDeliveryTime: new Date()
      });
      
      // Deactivate tracking
      tracking.isActive = false;
      await tracking.save();
    }
    
    res.json({
      success: true,
      message: `Delivery status updated to ${status}`,
      data: {
        status: status,
        timestamp: new Date(),
        location: tracking.currentLocation
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Status update failed");
  }
});

// Helper Functions

/**
 * Get address from coordinates using Here Maps Geocoding API
 */
async function getAddressFromCoordinates(latitude, longitude) {
  try {
    const response = await axios.get(`${HERE_BASE_URL}/v1/revgeocode`, {
      params: {
        at: `${latitude},${longitude}`,
        apikey: HERE_API_KEY,
        lang: 'en-US'
      }
    });
    
    if (response.data && response.data.items && response.data.items.length > 0) {
      return response.data.items[0].address.label;
    }
    return `${latitude}, ${longitude}`;
  } catch (error) {
    console.log('Geocoding error:', error.message);
    return `${latitude}, ${longitude}`;
  }
}

/**
 * Get coordinates from address using Here Maps Geocoding API
 */
async function getCoordinatesFromAddress(address) {
  try {
    const response = await axios.get(`${HERE_BASE_URL}/v1/geocode`, {
      params: {
        q: address,
        apikey: HERE_API_KEY,
        limit: 1
      }
    });
    
    if (response.data && response.data.items && response.data.items.length > 0) {
      const item = response.data.items[0];
      return [item.position.lng, item.position.lat];
    }
    return null;
  } catch (error) {
    console.log('Geocoding error:', error.message);
    return null;
  }
}

/**
 * Get optimized route from Here Maps Routing API
 */
async function getOptimizedRoute(start, waypoints) {
  try {
    const waypointString = waypoints.map(wp => `${wp[1]},${wp[0]}`).join(';');
    const startString = `${start[1]},${start[0]}`;
    
    const response = await axios.get(`${HERE_BASE_URL}/v8/routes`, {
      params: {
        origin: startString,
        destination: waypoints[waypoints.length - 1].join(','),
        waypoint0: waypointString,
        apikey: HERE_API_KEY,
        transportMode: 'car',
        return: 'polyline,summary,actions,instructions'
      }
    });
    
    if (response.data && response.data.routes && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      return {
        distance: route.sections[0].summary.length,
        duration: route.sections[0].summary.duration,
        polyline: route.sections[0].polyline,
        instructions: route.sections[0].actions.map(action => ({
          instruction: action.instruction,
          distance: action.length,
          duration: action.duration,
          coordinates: [action.offset]
        }))
      };
    }
    
    throw new Error('No route found');
  } catch (error) {
    console.log('Routing error:', error.message);
    throw error;
  }
}

/**
 * Check geofences and trigger notifications
 */
async function checkGeofences(tracking, latitude, longitude) {
  try {
    const geofences = await Geofence.find({
      status: 'active',
      'center.coordinates': {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [longitude, latitude]
          },
          $maxDistance: 5000 // 5km radius
        }
      }
    });
    
    for (const geofence of geofences) {
      const isInside = geofence.isPointInside(longitude, latitude);
      const wasInside = tracking.geofences.find(gf => gf.name === geofence.name);
      
      if (isInside && !wasInside) {
        // Entered geofence
        tracking.geofences.push({
          name: geofence.name,
          type: geofence.type,
          center: geofence.center,
          radius: geofence.radius,
          enteredAt: new Date()
        });
        
        tracking.notifications.push({
          type: 'geofence_enter',
          message: `Entered ${geofence.name}`,
          timestamp: new Date()
        });
      } else if (!isInside && wasInside) {
        // Exited geofence
        const geofenceIndex = tracking.geofences.findIndex(gf => gf.name === geofence.name);
        if (geofenceIndex !== -1) {
          tracking.geofences[geofenceIndex].exitedAt = new Date();
        }
        
        tracking.notifications.push({
          type: 'geofence_exit',
          message: `Exited ${geofence.name}`,
          timestamp: new Date()
        });
      }
    }
    
    await tracking.save();
  } catch (error) {
    console.log('Geofence check error:', error.message);
  }
}

/**
 * Publish location update to WebSocket clients
 */
async function publishLocationUpdate(deliveryAgentId, orderId, locationData) {
  try {
    await redisClient.publish('location_updates', JSON.stringify({
      deliveryAgentId,
      orderId,
      location: locationData,
      timestamp: new Date()
    }));
  } catch (error) {
    console.log('WebSocket publish error:', error.message);
  }
}

module.exports = {
  updateLocation,
  getRoute,
  getCurrentLocation,
  getTrackingHistory,
  updateDeliveryStatus
};
