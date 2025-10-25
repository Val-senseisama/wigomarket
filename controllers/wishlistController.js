const asyncHandler = require("express-async-handler");
const Wishlist = require("../models/wishlistModel");
const Product = require("../models/productModel");
const { ThrowError } = require("../Helpers/Helpers");
const { validateMongodbId } = require("../utils/validateMongodbId");

/**
 * @function addToWishlist
 * @description Add a product to user's wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.productId - Product ID to add
 * @param {string} [req.body.notes] - Optional notes for the product
 * @returns {Object} - Updated wishlist data
 */
const addToWishlist = asyncHandler(async (req, res) => {
  const { productId, notes = '' } = req.body;
  const userId = req.user._id;

  // Validate product ID
  if (!validateMongodbId(productId)) {
    ThrowError("Invalid product ID");
  }

  // Check if product exists
  const product = await Product.findById(productId);
  if (!product) {
    ThrowError("Product not found");
  }

  // Get or create wishlist for user
  const wishlist = await Wishlist.getOrCreateWishlist(userId);

  // Check if product is already in wishlist
  if (wishlist.hasProduct(productId)) {
    ThrowError("Product already in wishlist");
  }

  // Add product to wishlist
  await wishlist.addProduct(productId, notes);

  // Populate and return updated wishlist
  const populatedWishlist = await wishlist.getPopulatedWishlist();

  res.json({
    success: true,
    message: "Product added to wishlist successfully",
    data: {
      wishlist: populatedWishlist,
      addedProduct: product
    }
  });
});

/**
 * @function removeFromWishlist
 * @description Remove a product from user's wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.productId - Product ID to remove
 * @returns {Object} - Updated wishlist data
 */
const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const userId = req.user._id;

  // Validate product ID
  if (!validateMongodbId(productId)) {
    ThrowError("Invalid product ID");
  }

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    ThrowError("Wishlist not found");
  }

  // Check if product is in wishlist
  if (!wishlist.hasProduct(productId)) {
    ThrowError("Product not found in wishlist");
  }

  // Remove product from wishlist
  await wishlist.removeProduct(productId);

  // Populate and return updated wishlist
  const populatedWishlist = await wishlist.getPopulatedWishlist();

  res.json({
    success: true,
    message: "Product removed from wishlist successfully",
    data: {
      wishlist: populatedWishlist
    }
  });
});

/**
 * @function getWishlist
 * @description Get user's wishlist with populated products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} [req.query.page=1] - Page number for pagination
 * @param {number} [req.query.limit=20] - Items per page
 * @returns {Object} - User's wishlist data
 */
const getWishlist = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20 } = req.query;

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    return res.json({
      success: true,
      message: "Wishlist is empty",
      data: {
        wishlist: {
          products: [],
          totalItems: 0,
          pagination: {
            currentPage: 1,
            totalPages: 0,
            totalItems: 0,
            hasNext: false,
            hasPrev: false
          }
        }
      }
    });
  }

  // Populate products with store information
  const populatedWishlist = await wishlist.getPopulatedWishlist();

  // Paginate products
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedProducts = populatedWishlist.products.slice(startIndex, endIndex);

  const totalPages = Math.ceil(populatedWishlist.products.length / limit);

  res.json({
    success: true,
    message: "Wishlist retrieved successfully",
    data: {
      wishlist: {
        _id: populatedWishlist._id,
        name: populatedWishlist.name,
        isPublic: populatedWishlist.isPublic,
        totalItems: populatedWishlist.totalItems,
        lastUpdated: populatedWishlist.lastUpdated,
        products: paginatedProducts,
        pagination: {
          currentPage: parseInt(page),
          totalPages: totalPages,
          totalItems: populatedWishlist.products.length,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    }
  });
});

/**
 * @function checkProductInWishlist
 * @description Check if a specific product is in user's wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.productId - Product ID to check
 * @returns {Object} - Boolean indicating if product is in wishlist
 */
const checkProductInWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const userId = req.user._id;

  // Validate product ID
  if (!validateMongodbId(productId)) {
    ThrowError("Invalid product ID");
  }

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  const isInWishlist = wishlist ? wishlist.hasProduct(productId) : false;

  res.json({
    success: true,
    message: "Product wishlist status retrieved",
    data: {
      productId: productId,
      isInWishlist: isInWishlist
    }
  });
});

/**
 * @function clearWishlist
 * @description Clear all products from user's wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Success message
 */
const clearWishlist = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    ThrowError("Wishlist not found");
  }

  // Clear all products
  wishlist.products = [];
  await wishlist.save();

  res.json({
    success: true,
    message: "Wishlist cleared successfully",
    data: {
      wishlist: {
        _id: wishlist._id,
        products: [],
        totalItems: 0
      }
    }
  });
});

/**
 * @function updateWishlistSettings
 * @description Update wishlist settings (name, privacy)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} [req.body.name] - New wishlist name
 * @param {boolean} [req.body.isPublic] - Privacy setting
 * @returns {Object} - Updated wishlist settings
 */
const updateWishlistSettings = asyncHandler(async (req, res) => {
  const { name, isPublic } = req.body;
  const userId = req.user._id;

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    ThrowError("Wishlist not found");
  }

  // Update settings
  if (name !== undefined) {
    wishlist.name = name;
  }
  if (isPublic !== undefined) {
    wishlist.isPublic = isPublic;
  }

  await wishlist.save();

  res.json({
    success: true,
    message: "Wishlist settings updated successfully",
    data: {
      wishlist: {
        _id: wishlist._id,
        name: wishlist.name,
        isPublic: wishlist.isPublic,
        totalItems: wishlist.totalItems
      }
    }
  });
});

/**
 * @function getPublicWishlist
 * @description Get a public wishlist by user ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.userId - User ID whose wishlist to view
 * @returns {Object} - Public wishlist data
 */
const getPublicWishlist = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  // Validate user ID
  if (!validateMongodbId(userId)) {
    ThrowError("Invalid user ID");
  }

  // Get public wishlist
  const wishlist = await Wishlist.findOne({ 
    user: userId, 
    isPublic: true 
  });

  if (!wishlist) {
    ThrowError("Public wishlist not found or user has not made their wishlist public");
  }

  // Populate products
  const populatedWishlist = await wishlist.getPopulatedWishlist();

  res.json({
    success: true,
    message: "Public wishlist retrieved successfully",
    data: {
      wishlist: populatedWishlist
    }
  });
});

module.exports = {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  checkProductInWishlist,
  clearWishlist,
  updateWishlistSettings,
  getPublicWishlist
};
