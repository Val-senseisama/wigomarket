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
  try {
    const findProduct = await Product.findById(id).populate("store", "name image mobile address");
    if (!findProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    res.json(findProduct);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getAProduct;
