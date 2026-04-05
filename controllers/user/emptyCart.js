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
 * @function emptyCart
 * @description Empties user's cart by removing it from the database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @returns {Object} - Success message
 * @throws {Error} - Throws error if cart removal fails
 */
const emptyCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);

  try {
    const cart = await Cart.findOneAndDelete({ owner: _id });

    if (!cart) {
      return res.json({
        success: true,
        message: "Cart is already empty",
        data: {
          products: [],
          cartTotal: 0,
          owner: _id,
        },
      });
    }

    res.json({
      success: true,
      message: "Cart emptied successfully",
      data: {
        products: [],
        cartTotal: 0,
        owner: _id,
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }

});

module.exports = emptyCart;
