const Product = require("../models/productModel");
const ProductReview = require("../models/productReviewModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const mongoose = require("mongoose");
const Category = require("../models/categoryModel");
const Order = require("../models/orderModel");
const Cart = require("../models/cartModel");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const redisClient = require("../config/redisClient");
const audit = require("../services/auditService");
const { ThrowError } = require("../Helpers/Helpers");
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
  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }
  const findCategory = await Category.findOne({ name: name });
  if (!findCategory) {
    // Create new Store
    const newCategory = await Category.create({
      name: name,
    });
    audit.log({
      action: "product.category_created",
      actor: audit.actor(req),
      resource: { type: "category", id: newCategory._id, displayName: name },
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
    audit.log({
      action: "product.category_updated",
      actor: audit.actor(req),
      resource: { type: "category", id: id, displayName: name },
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
    const products = await Product.find({ category: categoryId }).populate(
      "store",
      "name image mobile address",
    ); // Find products by category ID
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

    audit.log({
      action: "product.category_deleted",
      actor: audit.actor(req),
      resource: { type: "category", id: id },
    });
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
  const {
    title, price, quantity, category, brand, description,
    images, specifications, sizes, colors,
  } = req.body;

  validateMongodbId(category);

  if (!Validate.string(title))                     ThrowError("Invalid Title");
  if (!Validate.integer(price) || price <= 0)      ThrowError("Invalid Price");
  if (!Validate.integer(quantity) || quantity < 0) ThrowError("Invalid Quantity");
  if (!Validate.string(brand))                     ThrowError("Invalid Brand");
  if (!Validate.string(description))               ThrowError("Invalid Description");

  // ── Images ──────────────────────────────────────────────────────────────
  let validatedImages = [];
  if (images !== undefined) {
    if (!Array.isArray(images)) {
      return res.status(400).json({ success: false, message: "images must be an array of Cloudinary URLs" });
    }
    if (images.length > 5) {
      return res.status(400).json({ success: false, message: "A maximum of 5 product images are allowed" });
    }
    const bad = images.filter((u) => !Validate.cloudinaryUrl(u));
    if (bad.length > 0) {
      return res.status(400).json({ success: false, message: "All images must be valid Cloudinary URLs. Upload via POST /api/upload/signature (folder: products).", invalidUrls: bad });
    }
    validatedImages = images;
  }

  // ── Specifications ───────────────────────────────────────────────────────
  let validatedSpecs = [];
  if (specifications !== undefined) {
    if (!Array.isArray(specifications)) {
      return res.status(400).json({ success: false, message: "specifications must be an array of { key, value } objects" });
    }
    for (const s of specifications) {
      if (!s?.key || !s?.value || typeof s.key !== "string" || typeof s.value !== "string") {
        return res.status(400).json({ success: false, message: "Each specification must have a string key and a string value" });
      }
    }
    validatedSpecs = specifications;
  }

  // ── Sizes ────────────────────────────────────────────────────────────────
  let validatedSizes = [];
  if (sizes !== undefined) {
    if (!Array.isArray(sizes) || !sizes.every((s) => typeof s === "string")) {
      return res.status(400).json({ success: false, message: "sizes must be an array of strings" });
    }
    validatedSizes = sizes;
  }

  // ── Colors ───────────────────────────────────────────────────────────────
  let validatedColors = [];
  if (colors !== undefined) {
    if (!Array.isArray(colors)) {
      return res.status(400).json({ success: false, message: "colors must be an array of { name, hex? } objects" });
    }
    for (const c of colors) {
      if (!c?.name || typeof c.name !== "string") {
        return res.status(400).json({ success: false, message: "Each color must have a string name field" });
      }
    }
    validatedColors = colors;
  }

  const sellersPrice = price;
  const commission   = (sellersPrice * 2) / 100;
  const listedPrice  = sellersPrice + commission;

  try {
    let newProduct = await Product.create({
      title,
      slug:           slugify(title),
      price:          sellersPrice,
      listedPrice,
      quantity,
      category,
      brand,
      description,
      images:         validatedImages,
      specifications: validatedSpecs,
      sizes:          validatedSizes,
      colors:         validatedColors,
      store:          req.store,
    });
    newProduct = await newProduct.populate([
      { path: "store",    select: "name image" },
      { path: "category", select: "name" },
    ]);

    audit.log({
      action: "product.created",
      actor: audit.actor(req),
      resource: { type: "product", id: newProduct._id, displayName: title },
      changes: { after: { title, price: sellersPrice, listedPrice, quantity, category, brand, imageCount: validatedImages.length } },
    });

    res.status(201).json({ success: true, data: newProduct });
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
  validateMongodbId(id);

  if (req.body.title      && !Validate.string(req.body.title))       ThrowError("Invalid Title");
  if (req.body.brand      && !Validate.string(req.body.brand))       ThrowError("Invalid Brand");
  if (req.body.description && !Validate.string(req.body.description)) ThrowError("Invalid Description");
  if (req.body.price    !== undefined && (!Validate.float(req.body.price)    || req.body.price    <= 0)) ThrowError("Invalid Price");
  if (req.body.quantity !== undefined && (!Validate.integer(req.body.quantity) || req.body.quantity < 0)) ThrowError("Invalid Quantity");

  // Whitelist — callers cannot overwrite internal fields (sold, views, store, rating, etc.)
  const ALLOWED = [
    "title", "price", "quantity", "category", "brand", "description",
    "images", "tags", "isFeatured",
    "specifications", "sizes", "colors",
  ];
  const updateData = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ success: false, message: "No valid fields to update" });
  }

  // Recompute listedPrice when price changes
  if (updateData.price !== undefined) {
    updateData.listedPrice = updateData.price + (updateData.price * 2) / 100;
  }

  if (updateData.title) {
    updateData.slug = slugify(updateData.title);
  }

  try {
    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    audit.log({
      action: "product.updated",
      actor: audit.actor(req),
      resource: { type: "product", id, displayName: updatedProduct.title },
      changes: { before: { fieldsChanged: Object.keys(updateData) }, after: updateData },
    });

    res.json({ success: true, data: updatedProduct });
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
  const { id } = req.body;
  try {
    const deleteProduct = await Product.findOneAndDelete(id);
    audit.log({
      action: "product.deleted",
      actor: audit.actor(req),
      resource: { type: "product", id: id },
    });
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
  const { id } = req.params;
  validateMongodbId(id);

  const product = await Product.findById(id)
    .populate("store",    "name image mobile address")
    .populate("category", "name")
    .select("-__v")
    .lean();

  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  // Increment view count (fire-and-forget, non-blocking)
  Product.findByIdAndUpdate(id, { $inc: { views: 1 } }).catch(() => {});

  res.json({ success: true, data: product });
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
  let { page, limit } = req.body;
  if (!Validate.integer(page) || page <= 0) {
    page = 1;
  }
  if (!Validate.integer(limit) || limit <= 0) {
    limit = 30;
  }
  try {
    const totalProducts = await Product.countDocuments({
      quantity: { $gt: 0 },
    });
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
          as: "storeDetails", // Name of the new array field to add
        },
      },
      {
        $unwind: {
          path: "$storeDetails", // Unwind the storeDetails array
          preserveNullAndEmptyArrays: true, // Keep products without a store
        },
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
          "storeDetails.mobile": 1, // Include store mobile
          "storeDetails.image": 1,
        },
      },
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
    sort = "newest",
    inStock = true,
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
    if (brand) filters.brand = new RegExp(brand, "i");
    if (search) {
      filters.$or = [
        { title: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
        { brand: new RegExp(search, "i") },
      ];
    }
    if (inStock === "true") filters.quantity = { $gt: 0 };

    // Build sort object
    const sortOptions = {};
    switch (sort) {
      case "price_asc":
        sortOptions.listedPrice = 1;
        break;
      case "price_desc":
        sortOptions.listedPrice = -1;
        break;
      case "newest":
        sortOptions.createdAt = -1;
        break;
      case "oldest":
        sortOptions.createdAt = 1;
        break;
      case "popular":
        sortOptions.sold = -1;
        break;
      case "rating":
        sortOptions["rating.average"] = -1;
        break;
      case "views":
        sortOptions.views = -1;
        break;
      default:
        sortOptions.createdAt = -1;
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const products = await Product.find(filters)
      .populate("category", "name")
      .populate("store", "name address mobile image")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filters);

    // Get filter options for response
    const categories = await Category.find({}, "name").limit(10);
    const brands = await Product.distinct("brand", filters);
    const priceRange = await Product.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          min: { $min: "$listedPrice" },
          max: { $max: "$listedPrice" },
        },
      },
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
          hasPrev: page > 1,
        },
        filters: {
          categories,
          brands: brands.filter((b) => b),
          priceRange: priceRange[0] || { min: 0, max: 0 },
        },
      },
    };

    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(response));

    // Track search analytics
    if (search) {
      await redisClient.lPush(
        "search_analytics",
        JSON.stringify({
          query: search,
          timestamp: new Date(),
          resultsCount: total,
        }),
      );
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
      .populate("products.product")
      .sort({ createdAt: -1 })
      .limit(10);

    // Get user's cart items
    const userCart = await Cart.findOne({ owner: _id }).populate(
      "products.product",
    );

    // Extract user preferences
    const userPreferences = {
      categories: [
        ...new Set(
          userOrders.flatMap((order) =>
            order.products
              .map((item) => item.product?.category)
              .filter(Boolean),
          ),
        ),
      ],
      brands: [
        ...new Set(
          userOrders.flatMap((order) =>
            order.products.map((item) => item.product?.brand).filter(Boolean),
          ),
        ),
      ],
      stores: [
        ...new Set(
          userOrders.flatMap((order) =>
            order.products.map((item) => item.product?.store).filter(Boolean),
          ),
        ),
      ],
    };

    // Get suggested products based on preferences
    let suggestions = [];

    if (
      userPreferences.categories.length > 0 ||
      userPreferences.brands.length > 0
    ) {
      const suggestionFilters = {
        quantity: { $gt: 0 },
      };

      if (
        userPreferences.categories.length > 0 ||
        userPreferences.brands.length > 0
      ) {
        suggestionFilters.$or = [];
        if (userPreferences.categories.length > 0) {
          suggestionFilters.$or.push({
            category: { $in: userPreferences.categories },
          });
        }
        if (userPreferences.brands.length > 0) {
          suggestionFilters.$or.push({
            brand: { $in: userPreferences.brands },
          });
        }
      }

      suggestions = await Product.find(suggestionFilters)
        .populate("category", "name")
        .populate("store", "name address")
        .sort({ "rating.average": -1, sold: -1 })
        .limit(parseInt(limit));
    }

    // If no personalized suggestions, get trending products
    if (suggestions.length === 0) {
      suggestions = await Product.find({ quantity: { $gt: 0 } })
        .populate("category", "name")
        .populate("store", "name address")
        .sort({ sold: -1, views: -1 })
        .limit(parseInt(limit));
    }

    const response = {
      success: true,
      data: suggestions,
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
  const { limit = 10, timeframe = "7d" } = req.query;

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
      case "24h":
        dateFilter = {
          createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) },
        };
        break;
      case "7d":
        dateFilter = {
          createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
        };
        break;
      case "30d":
        dateFilter = {
          createdAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) },
        };
        break;
    }

    const trending = await Product.find({
      ...dateFilter,
      quantity: { $gt: 0 },
    })
      .populate("category", "name")
      .populate("store", "name address")
      .sort({ sold: -1, views: -1, "rating.average": -1 })
      .limit(parseInt(limit));

    const response = {
      success: true,
      data: trending,
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
        message: "Category not found",
      });
    }

    // Get products in this category
    const suggestions = await Product.find({
      category: categoryId,
      quantity: { $gt: 0 },
    })
      .populate("category", "name")
      .populate("store", "name address")
      .sort({ "rating.average": -1, sold: -1, views: -1 })
      .limit(parseInt(limit));

    const response = {
      success: true,
      data: {
        category: {
          _id: category._id,
          name: category.name,
        },
        suggestions,
      },
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
    await redisClient.lPush(
      "product_views",
      JSON.stringify({
        productId: id,
        timestamp: new Date(),
        userAgent: req.get("User-Agent"),
        ip: req.ip,
      }),
    );

    res.json({
      success: true,
      message: "View tracked successfully",
    });
  } catch (error) {
    throw new Error(error);
  }
});

// ── Product Reviews ────────────────────────────────────────────────────────

const REVIEW_TTL = 120; // 2 minutes — short so new reviews surface quickly

const SORT_OPTIONS = {
  recent:   { createdAt: -1 },
  helpful:  { helpful: -1, createdAt: -1 },
  highest:  { rating: -1,  createdAt: -1 },
  lowest:   { rating: 1,   createdAt: -1 },
};

/**
 * @function getProductReviews
 * @description Paginated reviews for a product with per-star breakdown.
 * @route GET /api/product/:id/reviews
 * @query {number} [page=1]
 * @query {number} [limit=10]  max 20
 * @query {string} [sort=recent]  recent | helpful | highest | lowest
 */
const getProductReviews = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const page     = Math.max(1, parseInt(req.query.page)  || 1);
  const limit    = Math.min(20, parseInt(req.query.limit) || 10);
  const sortKey  = SORT_OPTIONS[req.query.sort] ? req.query.sort : "recent";
  const sortOpt  = SORT_OPTIONS[sortKey];
  const skip     = (page - 1) * limit;

  const cacheKey = `product:reviews:${id}:${page}:${limit}:${sortKey}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  const productObjId = new mongoose.Types.ObjectId(id);

  const [reviews, total, breakdownRaw] = await Promise.all([
    ProductReview.find({ product: id, status: "active" })
      .sort(sortOpt)
      .skip(skip)
      .limit(limit)
      .populate("user", "firstname lastname image")
      .select("-__v -order")
      .lean(),

    ProductReview.countDocuments({ product: id, status: "active" }),

    // Star distribution: count of 1★ … 5★
    ProductReview.aggregate([
      { $match: { product: productObjId, status: "active" } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const b of breakdownRaw) breakdown[b._id] = b.count;

  const totalPages = Math.ceil(total / limit);
  const payload = {
    success: true,
    data: {
      reviews,
      breakdown,
      pagination: {
        currentPage: page,
        totalPages,
        totalResults: total,
        hasNext:  page < totalPages,
        hasPrev:  page > 1,
      },
    },
  };

  try {
    await redisClient.setex(cacheKey, REVIEW_TTL, JSON.stringify(payload));
  } catch (_) {}

  res.json(payload);
});

/**
 * @function createProductReview
 * @description Create or update the authenticated user's review for a product.
 *              Requires a verified purchase (a Delivered order containing this product).
 * @route POST /api/product/:id/reviews
 * @body  {number} rating   1–5 (required)
 * @body  {string} [comment]  max 1000 chars
 */
const createProductReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const { rating, comment } = req.body;
  const userId = req.user._id;

  if (!rating || !Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: "rating must be an integer between 1 and 5" });
  }
  if (comment !== undefined && typeof comment !== "string") {
    return res.status(400).json({ success: false, message: "comment must be a string" });
  }

  // ── Purchase verification: must have a Delivered order with this product ──
  const verifyingOrder = await Order.findOne({
    orderedBy:   userId,
    orderStatus: "Delivered",
    "products.product": new mongoose.Types.ObjectId(id),
  }).select("_id").lean();

  if (!verifyingOrder) {
    return res.status(403).json({
      success: false,
      message: "You can only review products you have purchased and received",
    });
  }

  // ── Upsert: one review per user per product ────────────────────────────
  const review = await ProductReview.findOneAndUpdate(
    { product: id, user: userId },
    {
      order:               verifyingOrder._id,
      rating:              Number(rating),
      comment:             comment?.trim() || "",
      isVerifiedPurchase:  true,
      status:              "active",
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );

  // Invalidate page-1 cache for all sort orders (most common landing)
  const sorts = Object.keys(SORT_OPTIONS);
  try {
    await Promise.all(
      sorts.map((s) => redisClient.del(`product:reviews:${id}:1:10:${s}`)),
    );
  } catch (_) {}

  res.status(201).json({ success: true, data: review });
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
  trackProductView,
  getProductReviews,
  createProductReview,
};
