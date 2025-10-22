const asyncHandler = require("express-async-handler");
const Rating = require("../models/ratingModel");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const DispatchProfile = require("../models/dispatchProfileModel");
const { validateMongodbId } = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");

/**
 * @function createRating
 * @description Create a rating and review for a delivery agent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.orderId - Order ID
 * @param {number} req.body.rating - Overall rating (1-5)
 * @param {Object} req.body.breakdown - Rating breakdown
 * @param {string} [req.body.review] - Review text
 * @returns {Object} - Created rating
 */
const createRating = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { orderId, rating, breakdown, review } = req.body;

  // Validate input
  if (!orderId || !rating || !breakdown) {
    return res.status(400).json({
      success: false,
      message: "Order ID, rating, and breakdown are required"
    });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false,
      message: "Rating must be between 1 and 5"
    });
  }

  validateMongodbId(orderId);

  try {
    // Get order details
    const order = await Order.findById(orderId)
      .populate('deliveryAgent', 'fullName')
      .populate('orderedBy', 'fullName');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // Check if order belongs to user
    if (order.orderedBy._id.toString() !== _id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This order doesn't belong to you."
      });
    }

    // Check if order is delivered
    if (order.deliveryStatus !== 'delivered') {
      return res.status(400).json({
        success: false,
        message: "Can only rate completed deliveries"
      });
    }

    // Check if already rated
    const existingRating = await Rating.findOne({ order: orderId });
    if (existingRating) {
      return res.status(400).json({
        success: false,
        message: "This order has already been rated"
      });
    }

    // Validate breakdown
    const requiredBreakdown = ['punctuality', 'communication', 'handling', 'professionalism'];
    for (const field of requiredBreakdown) {
      if (!breakdown[field] || breakdown[field] < 1 || breakdown[field] > 5) {
        return res.status(400).json({
          success: false,
          message: `Invalid ${field} rating. Must be between 1 and 5`
        });
      }
    }

    // Create rating
    const newRating = await Rating.create({
      order: orderId,
      deliveryAgent: order.deliveryAgent._id,
      customer: _id,
      rating: rating,
      review: review || '',
      breakdown: {
        punctuality: breakdown.punctuality,
        communication: breakdown.communication,
        handling: breakdown.handling,
        professionalism: breakdown.professionalism
      },
      isVerified: true // Auto-verify for completed orders
    });

    // Populate the response
    const populatedRating = await Rating.findById(newRating._id)
      .populate('deliveryAgent', 'fullName')
      .populate('customer', 'fullName')
      .populate('order', 'paymentIntent.id deliveryStatus');

    res.json({
      success: true,
      message: "Rating submitted successfully",
      data: populatedRating
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to create rating");
  }
});

/**
 * @function getDeliveryAgentRatings
 * @description Get ratings for a specific delivery agent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.deliveryAgentId - Delivery agent ID
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @param {number} [req.query.minRating] - Minimum rating filter
 * @returns {Object} - Ratings data
 */
const getDeliveryAgentRatings = asyncHandler(async (req, res) => {
  const { deliveryAgentId } = req.params;
  const { page = 1, limit = 10, minRating } = req.query;

  validateMongodbId(deliveryAgentId);

  try {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build filter
    const filter = { 
      deliveryAgent: deliveryAgentId,
      status: 'active'
    };
    
    if (minRating) {
      filter.rating = { $gte: parseInt(minRating) };
    }

    const ratings = await Rating.find(filter)
      .populate('customer', 'fullName')
      .populate('order', 'paymentIntent.id createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Rating.countDocuments(filter);

    // Get rating statistics
    const stats = await Rating.aggregate([
      { $match: { deliveryAgent: deliveryAgentId, status: 'active' } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratingDistribution: {
            $push: '$rating'
          },
          averageBreakdown: {
            $avg: {
              punctuality: '$breakdown.punctuality',
              communication: '$breakdown.communication',
              handling: '$breakdown.handling',
              professionalism: '$breakdown.professionalism'
            }
          }
        }
      }
    ]);

    // Calculate rating distribution
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (stats.length > 0 && stats[0].ratingDistribution) {
      stats[0].ratingDistribution.forEach(rating => {
        distribution[rating] = (distribution[rating] || 0) + 1;
      });
    }

    res.json({
      success: true,
      data: {
        ratings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalRatings: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1
        },
        statistics: {
          averageRating: stats[0]?.averageRating ? Math.round(stats[0].averageRating * 10) / 10 : 0,
          totalReviews: stats[0]?.totalReviews || 0,
          ratingDistribution: distribution,
          averageBreakdown: stats[0]?.averageBreakdown || {
            punctuality: 0,
            communication: 0,
            handling: 0,
            professionalism: 0
          }
        }
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get delivery agent ratings");
  }
});

/**
 * @function getMyRatings
 * @description Get ratings given by the authenticated user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=10] - Items per page
 * @returns {Object} - User's ratings
 */
const getMyRatings = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { page = 1, limit = 10 } = req.query;

  try {
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const ratings = await Rating.find({ customer: _id })
      .populate('deliveryAgent', 'fullName')
      .populate('order', 'paymentIntent.id createdAt deliveryStatus')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Rating.countDocuments({ customer: _id });

    res.json({
      success: true,
      data: {
        ratings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalRatings: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get your ratings");
  }
});

/**
 * @function updateRating
 * @description Update an existing rating
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.ratingId - Rating ID
 * @param {Object} req.body - Updated rating data
 * @returns {Object} - Updated rating
 */
const updateRating = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { ratingId } = req.params;
  const { rating, breakdown, review } = req.body;

  validateMongodbId(ratingId);

  try {
    const existingRating = await Rating.findById(ratingId);

    if (!existingRating) {
      return res.status(404).json({
        success: false,
        message: "Rating not found"
      });
    }

    // Check if user owns this rating
    if (existingRating.customer.toString() !== _id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only update your own ratings."
      });
    }

    // Check if rating can be updated (within 24 hours)
    const hoursSinceCreation = (new Date() - existingRating.createdAt) / (1000 * 60 * 60);
    if (hoursSinceCreation > 24) {
      return res.status(400).json({
        success: false,
        message: "Rating can only be updated within 24 hours of creation"
      });
    }

    const updateData = {};
    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({
          success: false,
          message: "Rating must be between 1 and 5"
        });
      }
      updateData.rating = rating;
    }

    if (breakdown) {
      const requiredBreakdown = ['punctuality', 'communication', 'handling', 'professionalism'];
      for (const field of requiredBreakdown) {
        if (breakdown[field] && (breakdown[field] < 1 || breakdown[field] > 5)) {
          return res.status(400).json({
            success: false,
            message: `Invalid ${field} rating. Must be between 1 and 5`
          });
        }
      }
      updateData.breakdown = { ...existingRating.breakdown, ...breakdown };
    }

    if (review !== undefined) {
      updateData.review = review;
    }

    const updatedRating = await Rating.findByIdAndUpdate(
      ratingId,
      updateData,
      { new: true }
    ).populate('deliveryAgent', 'fullName')
     .populate('order', 'paymentIntent.id deliveryStatus');

    res.json({
      success: true,
      message: "Rating updated successfully",
      data: updatedRating
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to update rating");
  }
});

/**
 * @function deleteRating
 * @description Delete a rating
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.ratingId - Rating ID
 * @returns {Object} - Success response
 */
const deleteRating = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { ratingId } = req.params;

  validateMongodbId(ratingId);

  try {
    const rating = await Rating.findById(ratingId);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: "Rating not found"
      });
    }

    // Check if user owns this rating
    if (rating.customer.toString() !== _id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You can only delete your own ratings."
      });
    }

    await Rating.findByIdAndDelete(ratingId);

    res.json({
      success: true,
      message: "Rating deleted successfully"
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to delete rating");
  }
});

/**
 * @function reportRating
 * @description Report an inappropriate rating
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.ratingId - Rating ID
 * @param {string} req.body.reason - Report reason
 * @returns {Object} - Success response
 */
const reportRating = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { ratingId, reason } = req.body;

  if (!ratingId || !reason) {
    return res.status(400).json({
      success: false,
      message: "Rating ID and reason are required"
    });
  }

  validateMongodbId(ratingId);

  try {
    const rating = await Rating.findByIdAndUpdate(
      ratingId,
      {
        $addToSet: { reportedBy: _id },
        $push: { reports: { reporter: _id, reason: reason, reportedAt: new Date() } },
        status: 'reported'
      },
      { new: true }
    );

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: "Rating not found"
      });
    }

    res.json({
      success: true,
      message: "Rating reported successfully"
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to report rating");
  }
});

module.exports = {
  createRating,
  getDeliveryAgentRatings,
  getMyRatings,
  updateRating,
  deleteRating,
  reportRating
};
