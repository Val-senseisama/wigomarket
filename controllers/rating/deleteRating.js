const asyncHandler = require("express-async-handler");
const Rating = require("../../models/ratingModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const audit = require("../../services/auditService");

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

    audit.log({
      action: "rating.deleted",
      actor: audit.actor(req),
      resource: { type: "rating", id: ratingId },
      changes: { before: { rating: rating.rating, deliveryAgent: rating.deliveryAgent } },
    });

    res.json({
      success: true,
      message: "Rating deleted successfully"
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to delete rating");
  }

});

module.exports = deleteRating;
