const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function getEarningsHistory
 * @description Get detailed history of orders that contributed to earnings
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @param {string} [req.query.startDate] - Start date filter
 * @param {string} [req.query.endDate] - End date filter
 * @returns {Object} - List of completed orders with details
 */
const getEarningsHistory = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const skip = (page - 1) * limit;
  const { startDate, endDate } = req.query;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view earnings history."
    });
  }

  // Build query
  const query = {
    deliveryAgent: _id,
    deliveryStatus: 'delivered'
  };

  if (startDate || endDate) {
    query.actualDeliveryTime = {};
    if (startDate) query.actualDeliveryTime.$gte = new Date(startDate);
    if (endDate) query.actualDeliveryTime.$lte = new Date(endDate);
  }

  try {
    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate("orderedBy", "fullName email mobile")
        .populate("products.product", "title images listedPrice")
        .populate("products.store", "name address mobile")
        .sort({ actualDeliveryTime: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(query)
    ]);

    res.json({
      success: true,
      data: {
        orders,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalOrders: total,
          hasNext: skip + orders.length < total,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.error(error);
    throw new Error(error.message || "Failed to get earnings history");
  }
});

module.exports = getEarningsHistory;
