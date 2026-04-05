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

module.exports = getTrackingHistory;
