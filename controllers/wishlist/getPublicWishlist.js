const asyncHandler = require("express-async-handler");
const Wishlist = require("../../models/wishlistModel");
const Product = require("../../models/productModel");
const { ThrowError } = require("../../Helpers/Helpers");
const validateMongodbId = require("../../utils/validateMongodbId");

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
  validateMongodbId(userId);

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

module.exports = getPublicWishlist;
