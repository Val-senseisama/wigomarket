const asyncHandler = require("express-async-handler");
const Wishlist = require("../../models/wishlistModel");
const Product = require("../../models/productModel");
const { ThrowError } = require("../../Helpers/Helpers");
const validateMongodbId = require("../../utils/validateMongodbId");

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
  validateMongodbId(productId);

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

module.exports = removeFromWishlist;
