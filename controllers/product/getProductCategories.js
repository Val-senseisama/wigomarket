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
 * @function getProductCategories
 * @description Get all product categories
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Array} - Array of all product categories
 * @throws {Error} - Throws error if categories retrieval fails
 */
const getProductCategories = asyncHandler(async (req, res) => {

  try {
    const category = await Category.find();
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json(category);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getProductCategories;
