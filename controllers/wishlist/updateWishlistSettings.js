const asyncHandler = require("express-async-handler");
const Wishlist = require("../../models/wishlistModel");
const Product = require("../../models/productModel");
const { ThrowError } = require("../../Helpers/Helpers");
const validateMongodbId = require("../../utils/validateMongodbId");

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

module.exports = updateWishlistSettings;
