const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Validate = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function verifyResetToken
 * @description Verifies if a password reset token is valid and not expired
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.token - 6-digit reset token (required)
 * @param {string} req.body.email - User's email address (required)
 * @returns {Object} - Success message if valid
 */
const verifyResetToken = asyncHandler(async (req, res) => {
  const { token, email } = req.body;

  if (!Validate.string(token) || token.length !== 6) {
    ThrowError("Invalid Token - Must be 6 digits");
  }

  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  // Find token record
  const tokenRecord = await Token.findOne({
    email,
    code: hashedToken,
  });

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

  res.json({
    success: true,
    message: "Token is valid. You can proceed to reset your password.",
  });
});

module.exports = verifyResetToken;
