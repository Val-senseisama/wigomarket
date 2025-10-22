const Product = require("../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../models/categoryModel");
const Order = require("../models/orderModel");
const Cart = require("../models/cartModel");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const Redis = require("ioredis");

// Redis client setup with ioredis
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
});

redisClient.on('connect', () => {
  console.log('Redis connected successfully');
});
/**
 * @function createProductCategory
 * @description Create a new product category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.name - Name of the category (required)
 * @returns {Object} - Created category information
 * @throws {Error} - Throws error if category already exists or validation fails
 */
const createProductCategory = asyncHandler(async (req, res) => {
  const name = req.body.name;
  if(!Validate.string(name)){
    ThrowError("Invalid Name"); 
  }
  const findCategory = await Category.findOne({ name: name });
  if (!findCategory) {
    // Create new Store
    const newCategory = await Category.create({
      name: name,
    });
    res.json(newCategory);
  } else {
    res.json({
      msg: "Category already exists",
      success: false,
    });
    throw new Error("Category already exists");
  }
});
/**
 * @function deleteProductCategory
 * @description Delete a product category and its associated products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Category ID (required)
 * @returns {Object} - Deletion status message
 * @throws {Error} - Throws error if category ID is invalid
 */
const updateProductCategory = asyncHandler(async (req, res) => {
  const { id, name } = req.body;
  validateMongodbId(id);
  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }
  try {
    if (name) {
      req.body.slug = slugify(name);
    }
    const updatedCategory = await Category.findByIdAndUpdate(id, name, {
      new: true,
    });
    res.json(updatedCategory);
  } catch (error) {
    throw new Error(error);
  }
});

const getProductsByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.body; 
  // Validate the category ID
  validateMongodbId(categoryId);

  try {
    const products = await Product.find({ category: categoryId }).populate("store", "name image mobile address"); // Find products by category ID
    res.json(products);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function deleteProductCategory
 * @description Delete a product category and its associated products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Category ID (required)
 * @returns {Object} - Deletion status message
 * @throws {Error} - Throws error if category ID is invalid
 */
const deleteProductCategory = asyncHandler(async (req, res) => {
  const { id } = req.body; // Assuming category ID is passed as a URL parameter

  // Validate the category ID
  validateMongodbId(id);

  try {
    // Optionally, you can delete all products associated with this category
    await Product.deleteMany({ category: id });

    const deletedCategory = await Category.findByIdAndDelete(id);
    if (!deletedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function getProductCategories
 * @description Get all product categories
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Array} - Array of all product categories
 * @throws {Error} - Throws error if categories retrieval fails
 */
const getProductCategories = asyncHandler(async (req, res) => {

  try {
    const category = await Category.find();
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json(category);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function createProduct
 * @description Create a new product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.title - Product title (required)
 * @param {number} req.body.price - Product price (required)
 * @param {number} req.body.quantity - Product quantity (required)
 * @param {string} req.body.category - Category ID (required)
 * @param {string} req.body.brand - Product brand (required)
 * @param {string} req.body.description - Product description (required)
 * @returns {Object} - Created product information with store details
 * @throws {Error} - Throws error if validation fails or creation fails
 */
const createProduct = asyncHandler(async (req, res) => {
  const { title, price, quantity, category, brand, description,  } = req.body;
  validateMongodbId(category);
  // Validate input data
  if (!Validate.string(title)) {
    ThrowError("Invalid Title");
  }
  if (!Validate.integer(price) || price <= 0) {
    ThrowError("Invalid Price");
  }
  if (!Validate.integer(quantity) || quantity < 0) {
    ThrowError("Invalid Quantity");
  }
 
  if (!Validate.string(brand)) {
    ThrowError("Invalid Brand");
  }
  if (!Validate.string(description)) {
    ThrowError("Invalid Description");
  }

  const sellersPrice = price;
  const commission = (sellersPrice * 2) / 100;
  const listedPrice = sellersPrice + commission;

  try {
    let newProduct = await Product.create({
      title: title,
      slug: slugify(title),
      price: sellersPrice,
      listedPrice: listedPrice,
      quantity: quantity,
      category: category,
      brand: brand,
      description: description,
      store: req.store,
    });
    newProduct = await newProduct.populate("store", "name image");

    res.json(newProduct);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function updateProduct
 * @description Update an existing product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.id - Product ID (required)
 * @param {Object} req.body - Product update data
 * @param {string} [req.body.title] - Updated product title
 * @param {number} [req.body.price] - Updated product price
 * @param {number} [req.body.quantity] - Updated product quantity
 * @param {string} [req.body.category] - Updated category ID
 * @param {string} [req.body.brand] - Updated product brand
 * @param {string} [req.body.description] - Updated product description
 * @returns {Object} - Updated product information
 * @throws {Error} - Throws error if validation fails or product not found
 */
const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate input data
  if (req.body.title && !Validate.string(req.body.title)) {
    ThrowError("Invalid Title");
  }
  if (req.body.price && (!Validate.float(req.body.price) || req.body.price <= 0)) {
    ThrowError("Invalid Price");
  }
  if (req.body.quantity && (!Validate.integer(req.body.quantity) || req.body.quantity < 0)) {
    ThrowError("Invalid Quantity");
  }
  if (req.body.category && !Validate.string(req.body.category)) {
    ThrowError("Invalid Category");
  }
  if (req.body.brand && !Validate.string(req.body.brand)) {
    ThrowError("Invalid Brand");
  }
  if (req.body.description && !Validate.string(req.body.description)) {
    ThrowError("Invalid Description");
  }

  // Update slug if title is provided
  if (req.body.title) {
    req.body.slug = slugify(req.body.title);
  }

  try {
    const updatedProduct = await Product.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true, // Ensure that the update runs validation
    });

    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(updatedProduct);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function deleteProduct
 * @description Delete a product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Product ID (required)
 * @returns {Object} - Deletion status message
 * @throws {Error} - Throws error if deletion fails
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const {id} = req.body;
  try {
    const deleteProduct = await Product.findOneAndDelete(id);
    res.json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getAProduct
 * @description Get a single product by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Product ID (required)
 * @returns {Object} - Product information with store details
 * @throws {Error} - Throws error if product not found or retrieval fails
 */
const getAProduct = asyncHandler(async (req, res) => {
  const { id } = req.body;
  try {
    const findProduct = await Product.findById(id).populate("store", "name image mobile address");
    res.json(findProduct);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function getAllProducts
 * @description Get paginated list of all products with store details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.body.page=1] - Page number
 * @param {number} [req.body.limit=30] - Number of products per page
 * @returns {Object} - Paginated list of products with store details
 * @throws {Error} - Throws error if retrieval fails
 */
const getAllProducts = asyncHandler(async (req, res) => {
  let {page , limit} = req.body;
  if (!Validate.integer(page) || page <= 0) {
    page = 1;
  }
  if (!Validate.integer(limit) || limit <= 0) {
    limit = 30;
  }
  try {
    const totalProducts = await Product.countDocuments({ quantity: { $gt: 0 } });
    const totalPages = Math.ceil(totalProducts / limit);
    const findProduct = await Product.aggregate([
      { $match: { quantity: { $gt: 0 } } }, // Match products with stock > 0
      { $sort: { created_at: -1 } }, // Sort by creation date (descending)
      { $skip: (page - 1) * 30 }, // Skip previous pages
      { $limit: 30 }, // Limit to 30 products
      {
        $lookup: {
          from: "stores", // The name of the stores collection
          localField: "store", // Field from the products collection
          foreignField: "_id", // Field from the stores collection
          as: "storeDetails" // Name of the new array field to add
        }
      },
      {
        $unwind: {
          path: "$storeDetails", // Unwind the storeDetails array
          preserveNullAndEmptyArrays: true // Keep products without a store
        }
      },
      {
        $project: {
          title: 1, // Include product title
          quantity: 1, // Include product quantity
          listedPrice: 1, // Include product listed price
          image: 1, // Include product image
          description: 1, // Include product description
          brand: 1, // Include product brand
          "storeDetails.name": 1, // Include store name
          "storeDetails.address": 1, // Include store address
          "storeDetails.mobile": 1,// Include store mobile
          "storeDetails.image": 1
        }
      }
    ]);

    res.json({
      data: findProduct,
      totalProducts,
      totalPages,
      currentPage: page,
    });
    
  } catch (error) {
    throw new Error(error);
  }
});

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

module.exports = {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  createProductCategory,
  updateProductCategory,
  getProductsByCategory,
  deleteProductCategory,
  getProductCategories,
  getProducts,
  getPersonalizedSuggestions,
  getTrendingProducts,
  getCategorySuggestions,
  trackProductView
};
