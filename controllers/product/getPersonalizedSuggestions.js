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
 * @function getPersonalizedSuggestions
 * @description Get personalized product suggestions based on user's history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} [req.query.limit=10] - Number of suggestions
 * @returns {Object} - Personalized product suggestions
 */
const getPersonalizedSuggestions = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { limit = 10 } = req.query;
  
  const cacheKey = `personalized:${_id}:${limit}`;
  
  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // Get user's order history
    const userOrders = await Order.find({ orderedBy: _id })
      .populate('products.product')
      .sort({ createdAt: -1 })
      .limit(10);

    // Get user's cart items
    const userCart = await Cart.findOne({ owner: _id })
      .populate('products.product');

    // Extract user preferences
    const userPreferences = {
      categories: [...new Set(userOrders.flatMap(order => 
        order.products.map(item => item.product?.category).filter(Boolean)
      ))],
      brands: [...new Set(userOrders.flatMap(order => 
        order.products.map(item => item.product?.brand).filter(Boolean)
      ))],
      stores: [...new Set(userOrders.flatMap(order => 
        order.products.map(item => item.product?.store).filter(Boolean)
      ))]
    };

    // Get suggested products based on preferences
    let suggestions = [];
    
    if (userPreferences.categories.length > 0 || userPreferences.brands.length > 0) {
      const suggestionFilters = {
        quantity: { $gt: 0 }
      };

      if (userPreferences.categories.length > 0 || userPreferences.brands.length > 0) {
        suggestionFilters.$or = [];
        if (userPreferences.categories.length > 0) {
          suggestionFilters.$or.push({ category: { $in: userPreferences.categories } });
        }
        if (userPreferences.brands.length > 0) {
          suggestionFilters.$or.push({ brand: { $in: userPreferences.brands } });
        }
      }

      suggestions = await Product.find(suggestionFilters)
        .populate('category', 'name')
        .populate('store', 'name address')
        .sort({ 'rating.average': -1, sold: -1 })
        .limit(parseInt(limit));
    }

    // If no personalized suggestions, get trending products
    if (suggestions.length === 0) {
      suggestions = await Product.find({ quantity: { $gt: 0 } })
        .populate('category', 'name')
        .populate('store', 'name address')
        .sort({ sold: -1, views: -1 })
        .limit(parseInt(limit));
    }

    const response = {
      success: true,
      data: suggestions
    };

    // Cache for 30 minutes
    await redisClient.setex(cacheKey, 1800, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getPersonalizedSuggestions;
