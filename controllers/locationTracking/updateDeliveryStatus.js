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

module.exports = updateDeliveryStatus;
