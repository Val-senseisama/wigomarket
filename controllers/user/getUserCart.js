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
 * @function getUserCart
 * @description Retrieves user's cart with populated product details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @returns {Object} - User's cart with populated product details
 * @throws {Error} - Throws error if cart retrieval fails
 */
const getUserCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);

  try {
    const cart = await Cart.findOne({ owner: _id })
      .populate(
        "products.product",
        "title listedPrice images description brand quantity",
      )
      .populate("products.store", "name address mobile");

    if (!cart) {
      return res.json({
        success: true,
        data: {
          products: [],
          cartTotal: 0,
          owner: _id,
        },
      });
    }

    // Check if any products are out of stock or have been deleted
    const validProducts = [];
    let totalCost = 0;

    for (const item of cart.products) {
      if (item.product && item.product.quantity > 0) {
        // Update price if product price has changed
        const currentPrice = item.product.listedPrice;
        if (item.price !== currentPrice * item.count) {
          item.price = currentPrice * item.count;
        }
        totalCost += item.price;
        validProducts.push(item);
      }
    }

    // Update cart if products were removed
    if (validProducts.length !== cart.products.length) {
      cart.products = validProducts;
      cart.cartTotal = totalCost;
      await cart.save();
    }

    res.json({
      success: true,
      data: cart,
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }

});

module.exports = getUserCart;
