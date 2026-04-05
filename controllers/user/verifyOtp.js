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
 * @function verifyOtp
 * @description Verifies user's email verification code
 * @param {Object} req - Express request object containing email and code
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.code - Verification code (required)
 * @returns {Object} - Verification status message
 * @throws {Error} - Throws error if email or code is invalid
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }
  if (!Validate.string(code)) {
    ThrowError("Invalid Code");
  }
  const findToken = await Token.findOne({ email: email });
  if (!findToken) {
    return res.status(400).json({ msg: "Invalid or expired code", success: false });
  }
  if (findToken.code === code) {
    await User.findOneAndUpdate(
      { email: email },
      {
        status: "active",
      },
    );
    await Token.findOneAndDelete({ email: email });
    res.json({
      msg: "User verified",
      success: true,
    });
  } else {
    return res.status(400).json({
      msg: "Invalid code",
      success: false,
    });
  }

});

module.exports = verifyOtp;
