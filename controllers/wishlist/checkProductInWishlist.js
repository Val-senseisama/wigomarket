const asyncHandler = require("express-async-handler");
const Wishlist = require("../../models/wishlistModel");
const Product = require("../../models/productModel");
const { ThrowError } = require("../../Helpers/Helpers");
const validateMongodbId = require("../../utils/validateMongodbId");

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
  validateMongodbId(productId);

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

module.exports = checkProductInWishlist;
