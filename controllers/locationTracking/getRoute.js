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

module.exports = getRoute;
