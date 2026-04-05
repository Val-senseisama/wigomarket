const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function getDashboardStats
 * @description Get dashboard statistics for delivery agent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Dashboard statistics
 */
const getDashboardStats = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view dashboard."
    });
  }

  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeek = new Date(today - 7 * 24 * 60 * 60 * 1000);
    const thisMonth = new Date(today - 30 * 24 * 60 * 60 * 1000);

    // Get current active orders
    const activeOrders = await Order.find({
      deliveryAgent: _id,
      deliveryStatus: { $in: ['assigned', 'picked_up', 'in_transit'] }
    }).countDocuments();

    // Get today's deliveries
    const todayDeliveries = await Order.find({
      deliveryAgent: _id,
      deliveryStatus: 'delivered',
      actualDeliveryTime: { $gte: today }
    }).countDocuments();

    // Get this week's earnings
    const weekEarnings = await Order.aggregate([
      {
        $match: {
          deliveryAgent: _id,
          deliveryStatus: 'delivered',
          actualDeliveryTime: { $gte: thisWeek }
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$deliveryFee' },
          totalDeliveries: { $sum: 1 }
        }
      }
    ]);

    // Get this month's earnings
    const monthEarnings = await Order.aggregate([
      {
        $match: {
          deliveryAgent: _id,
          deliveryStatus: 'delivered',
          actualDeliveryTime: { $gte: thisMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$deliveryFee' },
          totalDeliveries: { $sum: 1 }
        }
      }
    ]);

    // Get recent orders
    const recentOrders = await Order.find({
      deliveryAgent: _id
    })
    .populate('orderedBy', 'fullName mobile')
    .populate('products.product', 'title listedPrice')
    .sort({ createdAt: -1 })
    .limit(5);

    // Get dispatch profile
    const dispatchProfile = await DispatchProfile.findOne({ user: _id });

    res.json({
      success: true,
      data: {
        overview: {
          activeOrders: activeOrders,
          todayDeliveries: todayDeliveries,
          weekEarnings: weekEarnings[0]?.totalEarnings || 0,
          weekDeliveries: weekEarnings[0]?.totalDeliveries || 0,
          monthEarnings: monthEarnings[0]?.totalEarnings || 0,
          monthDeliveries: monthEarnings[0]?.totalDeliveries || 0
        },
        profile: {
          status: dispatchProfile?.status || 'pending',
          isActive: dispatchProfile?.isActive || false,
          rating: dispatchProfile?.rating?.average || 0,
          totalReviews: dispatchProfile?.rating?.totalReviews || 0
        },
        recentOrders: recentOrders
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get dashboard stats");
  }

});

module.exports = getDashboardStats;
