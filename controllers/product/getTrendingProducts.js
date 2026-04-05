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
 * @function getTrendingProducts
 * @description Get trending products based on sales and views
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.query.limit=10] - Number of trending products
 * @param {string} [req.query.timeframe=7d] - Timeframe for trending (24h, 7d, 30d)
 * @returns {Object} - Trending products
 */
const getTrendingProducts = asyncHandler(async (req, res) => {
  const { limit = 10, timeframe = '7d' } = req.query;
  
  const cacheKey = `trending:${timeframe}:${limit}`;
  
  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    let dateFilter = {};
    const now = new Date();
    
    switch (timeframe) {
      case '24h':
        dateFilter = { createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) } };
        break;
      case '7d':
        dateFilter = { createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } };
        break;
      case '30d':
        dateFilter = { createdAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) } };
        break;
    }

    const trending = await Product.find({
      ...dateFilter,
      quantity: { $gt: 0 }
    })
    .populate('category', 'name')
    .populate('store', 'name address')
    .sort({ sold: -1, views: -1, 'rating.average': -1 })
    .limit(parseInt(limit));

    const response = {
      success: true,
      data: trending
    };

    // Cache for 2 hours
    await redisClient.setex(cacheKey, 7200, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getTrendingProducts;
