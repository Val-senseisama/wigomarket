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
 * @function updateCart
 * @description Updates product quantity in user's cart
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user.id - Authenticated user's ID (required)
 * @param {number} req.body.count - Current product count
 * @param {number} req.body.newCount - New product count to set
 * @param {string} req.body._id - Product ID in cart
 * @param {Object} req.body.product - Product details
 * @param {number} req.body.product.listedPrice - Product price
 * @returns {Object} - Updated cart information
 */
const updateCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { productId, newCount } = req.body;

  // Validate input
  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Product ID is required",
    });
  }

  if (newCount === undefined || newCount < 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid quantity",
    });
  }

  validateMongodbId(_id);
  validateMongodbId(productId);

  try {
    const cart = await Cart.findOne({ owner: _id });

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found",
      });
    }

    // Find product in cart
    const productIndex = cart.products.findIndex(
      (item) => item.product.toString() === productId,
    );

    if (productIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Product not found in cart",
      });
    }

    // Get product details for price calculation
    const productDetails = await Product.findById(productId);
    if (!productDetails) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // Check stock availability
    if (newCount > productDetails.quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock available",
      });
    }

    if (newCount === 0) {
      // Remove product if quantity is 0
      cart.products.splice(productIndex, 1);
    } else {
      // Update quantity and price
      cart.products[productIndex].count = newCount;
      cart.products[productIndex].price = newCount * productDetails.listedPrice;
    }

    // Recalculate total
    cart.cartTotal = cart.products.reduce(
      (total, item) => total + item.price,
      0,
    );

    await cart.save();

    // Populate and return updated cart
    const updatedCart = await Cart.findById(cart._id)
      .populate(
        "products.product",
        "title listedPrice images description brand",
      )
      .populate("products.store", "name address mobile");

    res.json({
      success: true,
      message: "Cart updated successfully",
      data: updatedCart,
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }

});

module.exports = updateCart;
