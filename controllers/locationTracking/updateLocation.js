const asyncHandler = require("express-async-handler");
const LocationTracking = require("../../models/locationTrackingModel");
const Geofence = require("../../models/geofenceModel");
const Order = require("../../models/orderModel");
const User = require("../../models/userModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const axios = require("axios");
const Redis = require("ioredis");

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

module.exports = updateLocation;
