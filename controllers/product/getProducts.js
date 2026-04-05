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
 * @function getProducts
 * @description Get products with advanced filtering, sorting, and pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=20] - Items per page
 * @param {string} [req.query.category] - Category ID filter
 * @param {string} [req.query.store] - Store ID filter
 * @param {number} [req.query.minPrice] - Minimum price filter
 * @param {number} [req.query.maxPrice] - Maximum price filter
 * @param {string} [req.query.brand] - Brand filter
 * @param {string} [req.query.search] - Search term
 * @param {string} [req.query.sort=newest] - Sort option
 * @param {boolean} [req.query.inStock=true] - In stock filter
 * @returns {Object} - Paginated products with filters
 */
const getProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    category,
    store,
    minPrice,
    maxPrice,
    brand,
    search,
    sort = 'newest',
    inStock = true
  } = req.query;

  // Create cache key
  const cacheKey = `products:${JSON.stringify(req.query)}`;
  
  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // Build filter object
    const filters = {};
    if (category) {
      validateMongodbId(category);
      filters.category = category;
    }
    if (store) {
      validateMongodbId(store);
      filters.store = store;
    }
    if (minPrice || maxPrice) {
      filters.listedPrice = {};
      if (minPrice) filters.listedPrice.$gte = parseFloat(minPrice);
      if (maxPrice) filters.listedPrice.$lte = parseFloat(maxPrice);
    }
    if (brand) filters.brand = new RegExp(brand, 'i');
    if (search) {
      filters.$or = [
        { title: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') },
        { brand: new RegExp(search, 'i') }
      ];
    }
    if (inStock === 'true') filters.quantity = { $gt: 0 };

    // Build sort object
    const sortOptions = {};
    switch (sort) {
      case 'price_asc': sortOptions.listedPrice = 1; break;
      case 'price_desc': sortOptions.listedPrice = -1; break;
      case 'newest': sortOptions.createdAt = -1; break;
      case 'oldest': sortOptions.createdAt = 1; break;
      case 'popular': sortOptions.sold = -1; break;
      case 'rating': sortOptions['rating.average'] = -1; break;
      case 'views': sortOptions.views = -1; break;
      default: sortOptions.createdAt = -1;
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const products = await Product.find(filters)
      .populate('category', 'name')
      .populate('store', 'name address mobile image')
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filters);

    // Get filter options for response
    const categories = await Category.find({}, 'name').limit(10);
    const brands = await Product.distinct('brand', filters);
    const priceRange = await Product.aggregate([
      { $match: filters },
      { $group: { _id: null, min: { $min: '$listedPrice' }, max: { $max: '$listedPrice' } } }
    ]);

    const response = {
      success: true,
      data: {
        products,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalProducts: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1
        },
        filters: {
          categories,
          brands: brands.filter(b => b),
          priceRange: priceRange[0] || { min: 0, max: 0 }
        }
      }
    };

    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(response));

    // Track search analytics
    if (search) {
      await redisClient.lPush('search_analytics', JSON.stringify({
        query: search,
        timestamp: new Date(),
        resultsCount: total
      }));
    }

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getProducts;
