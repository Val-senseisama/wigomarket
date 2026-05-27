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
 * @function verifyOtp
 * @description Verifies user's email OTP and, on success, activates the account
 *              and issues auth tokens so the user is immediately logged in.
 * @param {Object} req - Express request object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.code  - Verification code sent to email (required)
 * @returns {Object} - Auth payload: _id, activeRole, role, token, refreshToken, tokenExpiresAt
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }
  if (!Validate.string(code)) {
    ThrowError("Invalid Code");
  }

  const findToken = await Token.findOne({ email });
  if (!findToken) {
    return res.status(400).json({ msg: "Invalid or expired code", success: false });
  }

  if (findToken.code !== code) {
    return res.status(400).json({ msg: "Invalid code", success: false });
  }

  // Activate the account and fetch the updated user in one step
  const user = await User.findOneAndUpdate(
    { email },
    { status: "active" },
    { new: true, select: "_id role activeRole status" },
  );

  if (!user) {
    return res.status(404).json({ msg: "User not found", success: false });
  }

  // Delete the used OTP token
  await Token.findOneAndDelete({ email });

  // Issue tokens
  const accessToken = generateToken(user._id);
  const refreshToken = await generateRefreshToken(user._id);
  const tokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();

  // Persist the refresh token and set it as an HTTP-only cookie (for web clients)
  await User.findByIdAndUpdate(user._id, { refreshToken });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days
    sameSite: "Strict",
    secure: process.env.NODE_ENV === "production",
  });

  res.json({
    success: true,
    msg: "Email verified successfully",
    _id: user._id,
    role: user.role,
    activeRole: user.activeRole,
    token: accessToken,
    refreshToken,          // returned in body for mobile clients
    tokenExpiresAt,
  });
});

module.exports = verifyOtp;
