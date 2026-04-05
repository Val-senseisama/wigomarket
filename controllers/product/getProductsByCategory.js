const Product = require("../../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../../models/categoryModel");
const Order = require("../../models/orderModel");
const Cart = require("../../models/cartModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const Redis = require("ioredis");

const getProductsByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.body; 
  // Validate the category ID
  validateMongodbId(categoryId);

  try {
    const products = await Product.find({ category: categoryId }).populate("store", "name image mobile address"); // Find products by category ID
    res.json(products);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getProductsByCategory;
