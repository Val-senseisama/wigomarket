const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const { generateToken } = require("../../config/jwt");
const validateMongodbId = require("../../utils/validateMongodbId");
const { generateRefreshToken } = require("../../config/refreshToken");
const jwt = require("jsonwebtoken");
const sendEmail = require("../../controllers/emailController");
const crypto = require("crypto");
const Cart = require("../../models/cartModel");
const Validate = require("../../Helpers/Validate");
const Order = require("../../models/orderModel");
const Product = require("../../models/productModel");
const Store = require("../../models/storeModel");
const uniqid = require("uniqid");
const { ThrowError, MakeID } = require("../../Helpers/Helpers");

/**
 * @function addToCart2
 * @description Adds a product to user's cart
 * @param {Object} req - Express request object containing product data
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body.product - Product details to add to cart
 * @returns {Object} - Updated cart information
 * @throws {Error} - Throws error if cart operation fails
 */
const addToCart2 = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { product } = req.body;

  // Validate input
  if (!product._id || !product.count || product.count <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid product data",
    });
  }

  // Check if product exists and is in stock
  const productExists = await Product.findById(product._id);
  if (!productExists) {
    return res.status(404).json({
      success: false,
      message: "Product not found",
    });
  }

  if (productExists.quantity < product.count) {
    return res.status(400).json({
      success: false,
      message: "Insufficient stock available",
    });
  }

  // Find or create cart
  let cart = await Cart.findOne({ owner: _id });

  if (!cart) {
    cart = await Cart.create({
      owner: _id,
      products: [],
      cartTotal: 0,
    });
  }

  // Check if product already exists in cart
  const existingProductIndex = cart.products.findIndex(
    (item) => item.product.toString() === product._id,
  );

  if (existingProductIndex > -1) {
    // Update existing product quantity
    const newQuantity =
      cart.products[existingProductIndex].count + product.count;

    // Check if new quantity exceeds stock
    if (newQuantity > productExists.quantity) {
      return res.status(400).json({
        success: false,
        message: "Cannot add more items than available in stock",
      });
    }

    cart.products[existingProductIndex].count = newQuantity;
    cart.products[existingProductIndex].price =
      newQuantity * productExists.listedPrice;
  } else {
    // Add new product
    cart.products.push({
      product: product._id,
      count: product.count,
      price: product.count * productExists.listedPrice,
      store: product.store._id,
    });
  }

  // Recalculate total
  cart.cartTotal = cart.products.reduce((total, item) => total + item.price, 0);

  await cart.save();

  // Populate and return
  const populatedCart = await Cart.findById(cart._id)
    .populate("products.product", "title listedPrice images description brand")
    .populate("products.store", "name address mobile");

  res.json({
    success: true,
    message: "Product added to cart successfully",
    data: populatedCart,
  });

});

module.exports = addToCart2;
