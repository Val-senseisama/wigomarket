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
 * @function loginUser
 * @description Handles user login and token generation
 * @param {Object} req - Express request object containing login credentials
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.password - User's password (required)
 * @returns {Object} - User data and authentication tokens
 * @throws {Error} - Throws error if credentials are invalid
 */
// Access token lifetime in milliseconds — must stay in sync with jwt.js expiresIn
const ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  if (!Validate.string(password)) {
    ThrowError("Invalid Password");
  }

  // Check if user exists
  const findUser = await User.findOne(
    { email },
    { password: 1, status: 1, isBlocked: 1, role: 1, activeRole: 1, _id: 1 },
  );

  if (!findUser || !(await findUser.isPasswordMatched(password))) {
    throw new Error("Invalid Credentials");
  }

  if (findUser.isBlocked) {
    return res.status(403).json({ success: false, message: "Account is blocked" });
  }

  const accessToken = generateToken(findUser._id);
  const refreshToken = await generateRefreshToken(findUser._id);
  const tokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString();

  await User.findByIdAndUpdate(findUser._id, { refreshToken }, { new: true });

  // HTTP-only cookie for web clients
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days
    sameSite: "Strict",
    secure: process.env.NODE_ENV === "production",
  });

  res.json({
    _id: findUser._id,
    status: findUser.status,
    role: findUser.role,
    activeRole: findUser.activeRole,
    token: accessToken,
    refreshToken,      // returned in body for mobile clients
    tokenExpiresAt,
  });
});

module.exports = loginUser;
