const asyncHandler = require("express-async-handler");
const Rating = require("../../models/ratingModel");
const validateMongodbId = require("../../utils/validateMongodbId");

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

module.exports = reportRating;
