const asyncHandler = require("express-async-handler");
const Rating = require("../../models/ratingModel");
const Order = require("../../models/orderModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const audit = require("../../services/auditService");

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

    audit.log({
      action: "rating.created",
      actor: audit.actor(req),
      resource: { type: "rating", id: newRating._id },
      changes: { after: { rating, orderId, deliveryAgent: order.deliveryAgent._id, breakdown } },
    });

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

module.exports = createRating;
