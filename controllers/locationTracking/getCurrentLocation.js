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

module.exports = getCurrentLocation;
