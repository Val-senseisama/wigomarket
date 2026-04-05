const Product = require("../../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../../models/categoryModel");
const Order = require("../../models/orderModel");
const Cart = require("../../models/cartModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const Redis = require("ioredis");

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
      { $skip: (page - 1) * limit }, // Skip previous pages
      { $limit: limit }, // Limit per page
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

module.exports = getAllProducts;
