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
const audit = require("../../services/auditService");

/**
 * @function resetPassword
 * @description Resets user's password using 6-digit reset token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.password - New password to set (required)
 * @param {string} req.body.token - 6-digit reset token (required)
 * @param {string} req.body.email - User's email address (required)
 * @returns {Object} - Success message
 * @throws {Error} - Throws error if invalid token or user not found
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { password, token, email } = req.body;

  // Validate input
  if (!Validate.string(password)) {
    ThrowError("Invalid Password");
  }

  if (!Validate.string(token) || token.length !== 6) {
    ThrowError("Invalid Token - Must be 6 digits");
  }

  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Find user and token
  const user = await User.findOne(
    { email },
    { password: 1, _id: 1, fullName: 1 },
  );
  const tokenRecord = await Token.findOne({
    email,
    code: hashedToken,
  });

  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found",
    });
  }

  if (!tokenRecord) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  // Check if token is expired (15 minutes)
  const tokenAge = Date.now() - tokenRecord.createdAt;
  const fifteenMinutes = 15 * 60 * 1000;

  if (tokenAge > fifteenMinutes) {
    await Token.deleteOne({ email });
    return res.status(400).json({
      success: false,
      message: "Token has expired. Please request a new one.",
    });
  }

  try {
    // Update password
    user.password = password;
    await user.save();

    // Delete the used token
    await Token.deleteOne({ email });

    audit.log({
      action: "user.password_reset_success",
      actor: { email },
      resource: { type: "user", id: user._id },
    });

    res.json({
      success: true,
      message:
        "Password reset successfully. You can now login with your new password.",
    });
  } catch (error) {
    audit.error({
      action: "user.password_reset_failed",
      actor: { email },
      metadata: { error: error.message },
    });
    throw new Error(error);
  }
});

module.exports = resetPassword;
