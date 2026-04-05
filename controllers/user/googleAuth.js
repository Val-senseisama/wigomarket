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
 * @function googleAuth
 * @description Authenticate user with Google using Firebase ID token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.idToken - Firebase ID token from Google
 * @returns {Object} - User data and authentication tokens
 * @throws {Error} - Throws error if token is invalid
 */
const googleAuth = asyncHandler(async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({
      success: false,
      message: "ID token is required",
    });
  }

  try {
    // Import Firebase Admin SDK
    const admin = require("firebase-admin");

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    // Check if user exists in MongoDB by Firebase UID
    let user = await User.findOne({ firebaseUid: uid });

    if (!user) {
      // Check if user exists by email (for existing users who might link Google)
      const existingUser = await User.findOne({ email: email });

      if (existingUser) {
        // Link Firebase UID to existing user
        existingUser.firebaseUid = uid;
        existingUser.fullName = existingUser.fullName || name;
        existingUser.image = existingUser.image || picture;
        await existingUser.save();
        user = existingUser;
      } else {
        // Create new user with Google authentication
        user = await User.create({
          firebaseUid: uid,
          email: email,
          fullName: name,
          image: picture,
          role: ["buyer"], // Default role for Google auth users
          activeRole: "buyer",
          status: "active", // Auto-activate Google auth users
          password: null, // No password for Google auth users
        });
      }
    }

    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "User account is blocked",
      });
    }

    // Generate JWT token
    const token = generateToken(user._id);

    // Generate refresh token
    const refreshToken = await generateRefreshToken(user._id);

    // Update user's refresh token
    await User.findByIdAndUpdate(
      user._id,
      { refreshToken: refreshToken },
      { new: true },
    );

    // Set refresh token cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 72 * 60 * 60 * 1000, // 3 days
    });

    res.json({
      success: true,
      message: "Google authentication successful",
      data: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        image: user.image,
        role: user.role,
        activeRole: user.activeRole,
        status: user.status,
        token: token,
        isGoogleAuth: true,
      },
    });
  } catch (error) {
    console.error("Google auth error:", error);

    if (error.code === "auth/invalid-id-token") {
      return res.status(401).json({
        success: false,
        message: "Invalid Google ID token",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Google authentication failed",
      error: error.message,
    });
  }

});

module.exports = googleAuth;
