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
 * @function removeFromCart
 * @description Removes a product from user's cart
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @param {string} req.body.productId - Product ID to remove
 * @returns {Object} - Updated cart information
 * @throws {Error} - Throws error if cart update fails
 */
const removeFromCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { productId } = req.body;

  // Validate input
  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Product ID is required",
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

    // Check if product exists in cart
    const productIndex = cart.products.findIndex(
      (item) => item.product.toString() === productId,
    );

    if (productIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Product not found in cart",
      });
    }

    // Remove product from array
    cart.products.splice(productIndex, 1);

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
      message: "Product removed from cart successfully",
      data: updatedCart,
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }

});

module.exports = removeFromCart;
