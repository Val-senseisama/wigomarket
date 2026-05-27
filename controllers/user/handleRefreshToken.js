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

// Access token lifetime in milliseconds — must stay in sync with jwt.js expiresIn
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * @function handleRefreshToken
 * @description Issues a new access token given a valid refresh token.
 *              Accepts the refresh token from:
 *                1. HTTP-only cookie ("refreshToken") — web clients
 *                2. Request body field "refreshToken"  — mobile clients
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - { token, tokenExpiresAt }
 */
const handleRefreshToken = asyncHandler(async (req, res) => {
  // Accept from cookie (web) or request body (mobile)
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({
      success: false,
      message: "Refresh token is required",
    });
  }

  const user = await User.findOne({ refreshToken });
  if (!user) {
    return res.status(403).json({
      success: false,
      message: "Invalid or revoked refresh token",
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (user._id.toString() !== decoded.id) {
      return res.status(403).json({
        success: false,
        message: "Refresh token mismatch",
      });
    }

    const accessToken = generateToken(user._id);
    const tokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();

    res.json({
      success: true,
      token: accessToken,
      tokenExpiresAt,
    });
  } catch {
    return res.status(403).json({
      success: false,
      message: "Refresh token is invalid or expired",
    });
  }
});

module.exports = handleRefreshToken;
