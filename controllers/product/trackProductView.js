const Product = require("../../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../../models/categoryModel");
const Order = require("../../models/orderModel");
const Cart = require("../../models/cartModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const redisClient = require("../../config/redisClient");

/**
 * @function trackProductView
 * @description Track product view for analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.id - Product ID
 * @returns {Object} - Success message
 */
const trackProductView = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  try {
    // Increment view count
    await Product.findByIdAndUpdate(id, { $inc: { views: 1 } });
    
    // Track in analytics
    await redisClient.lPush('product_views', JSON.stringify({
      productId: id,
      timestamp: new Date(),
      userAgent: req.get('User-Agent'),
      ip: req.ip
    }));

    res.json({
      success: true,
      message: "View tracked successfully"
    });
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = trackProductView;
