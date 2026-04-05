const asyncHandler = require("express-async-handler");
const Wishlist = require("../../models/wishlistModel");
const Product = require("../../models/productModel");
const { ThrowError } = require("../../Helpers/Helpers");
const validateMongodbId = require("../../utils/validateMongodbId");

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

module.exports = clearWishlist;
