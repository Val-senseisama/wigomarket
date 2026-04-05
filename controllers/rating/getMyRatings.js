const asyncHandler = require("express-async-handler");
const Rating = require("../../models/ratingModel");

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

module.exports = getMyRatings;
