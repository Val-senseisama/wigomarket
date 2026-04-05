const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Rating = require("../../models/ratingModel");
const validateMongodbId = require("../../utils/validateMongodbId");

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
      { $match: { deliveryAgent: new mongoose.Types.ObjectId(deliveryAgentId), status: 'active' } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          ratingDistribution: { $push: '$rating' },
          avgPunctuality: { $avg: '$breakdown.punctuality' },
          avgCommunication: { $avg: '$breakdown.communication' },
          avgHandling: { $avg: '$breakdown.handling' },
          avgProfessionalism: { $avg: '$breakdown.professionalism' },
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
          averageBreakdown: stats[0] ? {
            punctuality: Math.round((stats[0].avgPunctuality || 0) * 10) / 10,
            communication: Math.round((stats[0].avgCommunication || 0) * 10) / 10,
            handling: Math.round((stats[0].avgHandling || 0) * 10) / 10,
            professionalism: Math.round((stats[0].avgProfessionalism || 0) * 10) / 10,
          } : { punctuality: 0, communication: 0, handling: 0, professionalism: 0 }
        }
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get delivery agent ratings");
  }

});

module.exports = getDeliveryAgentRatings;
