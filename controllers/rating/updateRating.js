const asyncHandler = require("express-async-handler");
const Rating = require("../../models/ratingModel");
const validateMongodbId = require("../../utils/validateMongodbId");

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

module.exports = updateRating;
