const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function getEarnings
 * @description Get delivery agent earnings and analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} [req.query.period] - Time period (week, month, year)
 * @returns {Object} - Earnings data
 */
const getEarnings = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { period = 'month' } = req.query;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view earnings."
    });
  }

  try {
    // Calculate date range based on period
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'week':
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
    }

    // Get completed deliveries in period
    const completedDeliveries = await Order.find({
      deliveryAgent: _id,
      deliveryStatus: 'delivered',
      actualDeliveryTime: { $gte: startDate, $lte: now }
    }).select('deliveryFee actualDeliveryTime createdAt');

    // Calculate earnings
    const totalEarnings = completedDeliveries.reduce((sum, order) => sum + (order.deliveryFee || 0), 0);
    const totalDeliveries = completedDeliveries.length;
    const averageEarningsPerDelivery = totalDeliveries > 0 ? totalEarnings / totalDeliveries : 0;

    // Get daily earnings breakdown
    const dailyEarnings = {};
    completedDeliveries.forEach(order => {
      const date = order.actualDeliveryTime.toISOString().split('T')[0];
      dailyEarnings[date] = (dailyEarnings[date] || 0) + (order.deliveryFee || 0);
    });

    // Get dispatch profile for total stats
    const dispatchProfile = await DispatchProfile.findOne({ user: _id });
    const totalLifetimeEarnings = dispatchProfile?.earnings?.totalEarnings || 0;
    const totalLifetimeDeliveries = dispatchProfile?.earnings?.totalDeliveries || 0;

    res.json({
      success: true,
      data: {
        period: period,
        currentPeriod: {
          totalEarnings: totalEarnings,
          totalDeliveries: totalDeliveries,
          averageEarningsPerDelivery: averageEarningsPerDelivery,
          dailyEarnings: dailyEarnings
        },
        lifetime: {
          totalEarnings: totalLifetimeEarnings,
          totalDeliveries: totalLifetimeDeliveries,
          averageEarningsPerDelivery: totalLifetimeDeliveries > 0 ? totalLifetimeEarnings / totalLifetimeDeliveries : 0
        },
        dateRange: {
          start: startDate,
          end: now
        }
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get earnings data");
  }

});

module.exports = getEarnings;
