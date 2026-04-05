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
 * @function getCategorySuggestions
 * @description Get product suggestions for a specific category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.categoryId - Category ID
 * @param {number} [req.query.limit=10] - Number of suggestions
 * @returns {Object} - Category-based product suggestions
 */
const getCategorySuggestions = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { limit = 10 } = req.query;
  
  validateMongodbId(categoryId);
  
  const cacheKey = `category_suggestions:${categoryId}:${limit}`;
  
  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // Get category details
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found"
      });
    }

    // Get products in this category
    const suggestions = await Product.find({
      category: categoryId,
      quantity: { $gt: 0 }
    })
    .populate('category', 'name')
    .populate('store', 'name address')
    .sort({ 'rating.average': -1, sold: -1, views: -1 })
    .limit(parseInt(limit));

    const response = {
      success: true,
      data: {
        category: {
          _id: category._id,
          name: category.name
        },
        suggestions
      }
    };

    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getCategorySuggestions;
