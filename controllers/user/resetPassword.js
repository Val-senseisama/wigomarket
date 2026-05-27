const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Validate = require("../../Helpers/Validate");
const audit = require("../../services/auditService");

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * @function resetPassword
 * @description Step 3 of 3 — sets a new password.
 *
 *   Requires the `resetSession` nonce that was returned by step 2
 *   (POST /api/user/verify-reset-token). The nonce is hashed and matched against
 *   the stored `sessionHash`, so only the client that completed step 2 can reach
 *   this endpoint. The token record is consumed atomically (findOneAndDelete) before
 *   the password is written — no race window.
 *
 * @param {string} req.body.email        - The same email used in steps 1 & 2
 * @param {string} req.body.password     - The new password (min 6 characters)
 * @param {string} req.body.resetSession - The nonce returned by step 2
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { email, password, resetSession } = req.body;

  if (!Validate.email(email)) {
    return res.status(400).json({ success: false, message: "Invalid email" });
  }

  if (!Validate.string(password) || password.length < 6) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 6 characters",
    });
  }

  if (!Validate.string(resetSession)) {
    return res.status(400).json({
      success: false,
      message: "resetSession is required. Complete step 2 first (POST /api/user/verify-reset-token).",
    });
  }

  const sessionHash = crypto.createHash("sha256").update(resetSession).digest("hex");

  // Atomically consume the token — findOneAndDelete prevents race conditions
  // where two concurrent requests could both read verified:true before either deletes it
  const tokenRecord = await Token.findOneAndDelete({
    email,
    verified: true,
    sessionHash,
  });

  if (!tokenRecord) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired session. Please start the reset process again.",
    });
  }

  // Guard against the verified record being used after the 15-minute window
  if (Date.now() - new Date(tokenRecord.createdAt).getTime() > FIFTEEN_MINUTES) {
    return res.status(400).json({
      success: false,
      message: "Session expired. Please start the reset process again.",
    });
  }

  const user = await User.findOne({ email }, { _id: 1 });
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  // Assign directly — userModel pre-save hook bcrypt-hashes it
  user.password = password;
  await user.save();

  audit.log({
    action: "user.password_reset_success",
    actor: { email },
    resource: { type: "user", id: user._id },
  });

  res.status(200).json({
    success: true,
    message: "Password reset successfully. Please log in with your new password.",
  });
});

module.exports = resetPassword;
