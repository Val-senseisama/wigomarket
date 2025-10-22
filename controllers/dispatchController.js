const asyncHandler = require("express-async-handler");
const Order = require("../models/orderModel");
const DispatchProfile = require("../models/dispatchProfileModel");
const User = require("../models/userModel");
const { validateMongodbId } = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");

/**
 * @function createDispatchProfile
 * @description Create dispatch profile for delivery agent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Dispatch profile data
 * @returns {Object} - Created dispatch profile
 */
const createDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const {
    vehicleInfo,
    coverageAreas,
    documents,
    workingHours,
    workingDays
  } = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can create dispatch profiles."
    });
  }

  // Check if profile already exists
  const existingProfile = await DispatchProfile.findOne({ user: _id });
  if (existingProfile) {
    return res.status(400).json({
      success: false,
      message: "Dispatch profile already exists for this user"
    });
  }

  try {
    const dispatchProfile = await DispatchProfile.create({
      user: _id,
      vehicleInfo: {
        type: vehicleInfo.type,
        make: vehicleInfo.make,
        model: vehicleInfo.model,
        year: vehicleInfo.year,
        plateNumber: vehicleInfo.plateNumber,
        color: vehicleInfo.color
      },
      coverageAreas: coverageAreas || [],
      documents: {
        driverLicense: {
          number: documents.driverLicense.number,
          expiryDate: documents.driverLicense.expiryDate,
          image: documents.driverLicense.image
        },
        vehicleRegistration: {
          number: documents.vehicleRegistration.number,
          expiryDate: documents.vehicleRegistration.expiryDate,
          image: documents.vehicleRegistration.image
        },
        insurance: {
          provider: documents.insurance.provider,
          policyNumber: documents.insurance.policyNumber,
          expiryDate: documents.insurance.expiryDate,
          image: documents.insurance.image
        }
      },
      availability: {
        workingHours: workingHours || { start: "09:00", end: "17:00" },
        workingDays: workingDays || ["monday", "tuesday", "wednesday", "thursday", "friday"]
      },
      status: "pending"
    });

    res.json({
      success: true,
      message: "Dispatch profile created successfully",
      data: dispatchProfile
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to create dispatch profile");
  }
});

/**
 * @function updateDispatchProfile
 * @description Update dispatch profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Updated profile data
 * @returns {Object} - Updated dispatch profile
 */
const updateDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const updateData = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update dispatch profiles."
    });
  }

  try {
    const dispatchProfile = await DispatchProfile.findOneAndUpdate(
      { user: _id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Dispatch profile not found"
      });
    }

    res.json({
      success: true,
      message: "Dispatch profile updated successfully",
      data: dispatchProfile
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to update dispatch profile");
  }
});

/**
 * @function getDispatchProfile
 * @description Get dispatch profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Dispatch profile data
 */
const getDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  try {
    const dispatchProfile = await DispatchProfile.findOne({ user: _id })
      .populate('user', 'fullName email mobile');

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Dispatch profile not found"
      });
    }

    res.json({
      success: true,
      data: dispatchProfile
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get dispatch profile");
  }
});

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

/**
 * @function updateAvailability
 * @description Update delivery agent availability status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.status - New availability status
 * @returns {Object} - Updated availability status
 */
const updateAvailability = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { status } = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update availability."
    });
  }

  const validStatuses = ["online", "offline", "busy", "unavailable"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status. Must be one of: " + validStatuses.join(", ")
    });
  }

  try {
    const dispatchProfile = await DispatchProfile.findOneAndUpdate(
      { user: _id },
      { 
        "availability.status": status,
        lastActiveAt: new Date()
      },
      { new: true }
    );

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Dispatch profile not found"
      });
    }

    res.json({
      success: true,
      message: `Availability updated to ${status}`,
      data: {
        status: status,
        lastActiveAt: dispatchProfile.lastActiveAt
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to update availability");
  }
});

// Legacy functions (keeping for backward compatibility)
const takeDispatch = asyncHandler(async (req, res) => {
  const { orderedBy } = req.body;
  const { _id } = req.dispatch._id;
  try {
    const dispatchTaken = await Order.findOneAndUpdate(
      { orderedBy: orderedBy },
      { $set: { dispatch: _id } },
      { new: true }
    );

    res.json(dispatchTaken);
  } catch (error) {
    throw new Error(error);
  }
});

const getDispatchOrders = asyncHandler(async (req, res) => {
  try {
    const dipatchOrders = await Order.find({ deliveryMethod: "dispatch" })
      .populate({
        path: "orderedBy",
        select: "firstname, lastname, nickname, mobile, email, address",
        model: "User",
      })
      .populate({
        path: "products.product",
        select: "store",
        model: "Product",
        populate: {
          path: "store",
          select: "address, owner",
          model: "Store",
          populate: {
            path: "owner",
            select: "mobile, email",
            model: "User",
          },
        },
      })
      .exec();
    res.json(dipatchOrders);
  } catch (error) {
    throw new Error(error);
  }
});

const dispatchCommission = asyncHandler(async (req, res) => {});

module.exports = { 
  createDispatchProfile,
  updateDispatchProfile,
  getDispatchProfile,
  getEarnings,
  getDashboardStats,
  updateAvailability,
  takeDispatch,
  getDispatchOrders,
  dispatchCommission
};
