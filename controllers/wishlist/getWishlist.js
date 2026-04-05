const asyncHandler = require("express-async-handler");
const Wishlist = require("../../models/wishlistModel");
const Product = require("../../models/productModel");
const { ThrowError } = require("../../Helpers/Helpers");
const validateMongodbId = require("../../utils/validateMongodbId");

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

module.exports = getWishlist;
