const asyncHandler = require("express-async-handler");
const Wishlist = require("../../models/wishlistModel");
const Product = require("../../models/productModel");
const { ThrowError } = require("../../Helpers/Helpers");
const validateMongodbId = require("../../utils/validateMongodbId");

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
  validateMongodbId(productId);

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

module.exports = addToWishlist;
