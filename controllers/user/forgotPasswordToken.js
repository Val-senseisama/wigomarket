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
const { forgotPasswordTemplate } = require("../../templates/Emails");
const audit = require("../../services/auditService");

/**
 * @function forgotPasswordToken
 * @description Generates and sends 6-digit password reset token to user's email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @returns {Object} - Success message with token info
 * @throws {Error} - Throws error if user not found or token creation fails
 */
const forgotPasswordToken = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  const user = await User.findOne({ email }, { fullName: 1, email: 1 });
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found with this email",
    });
  }

  const token = MakeID(16);

  try {
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Upsert the token in the database with 15-minute expiry
    const newToken = await Token.findOneAndUpdate(
      { email },
      { code: hashedToken, createdAt: Date.now() },
      { new: true, upsert: true },
    );

    if (!newToken) {
      throw new Error("Token not created");
    }

    const data = {
      to: email,
      text: `Password Reset Code: ${token}`,
      subject: "Password Reset Code - WigoMarket",
      htm: forgotPasswordTemplate(user?.fullName || "User", token),
    };

    sendEmail(data, true);

    audit.log({
      action: "user.password_reset_requested",
      actor: { email },
      resource: { type: "user", id: user._id },
    });

    res.json({
      success: true,
      message:
        "Password reset code sent to your email. Please check your inbox.",
      token: token, // For development/testing - remove in production
      expiresIn: "15 minutes",
    });
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = forgotPasswordToken;
