const User = require("../../models/userModel");
const asyncHandler = require("express-async-handler");
const Validate = require("../../Helpers/Validate");
const audit = require("../../services/auditService");
const issueSession = require("../../utils/issueSession");

/**
 * @function updatePassword
 * @description Lets the signed-in user change their password. The current
 * password is required: a bearer token alone may be a stolen or
 * left-signed-in session.
 *
 * Every session is signed out: saving the password stamps passwordChangedAt,
 * which authMiddleware uses to refuse older access tokens, and the stored
 * refresh token is replaced. The caller gets a new token pair and stays
 * signed in.
 *
 * Google accounts without a password are pointed at the forgot-password flow,
 * which sets one by email.
 *
 * @param {string} req.body.currentPassword - The password in use now
 * @param {string} req.body.newPassword     - The new password (min 6 characters)
 */
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  if (!user.password) {
    return res.status(400).json({
      success: false,
      message: "This account has no password yet. Set one with POST /api/user/forgot-password-token.",
    });
  }

  if (!Validate.string(currentPassword)) {
    return res.status(400).json({ success: false, message: "currentPassword is required" });
  }

  if (!Validate.string(newPassword) || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: "New password must be at least 6 characters",
    });
  }

  if (!(await user.isPasswordMatched(currentPassword))) {
    return res.status(401).json({ success: false, message: "Current password is incorrect" });
  }

  if (await user.isPasswordMatched(newPassword)) {
    return res.status(400).json({
      success: false,
      message: "New password must be different from the current one",
    });
  }

  // Assign directly — userModel pre-save hook bcrypt-hashes it and stamps
  // passwordChangedAt
  user.password = newPassword;
  await user.save();

  // Issued after the save so they are not older than passwordChangedAt
  const session = await issueSession(res, user);

  audit.log({
    action: "user.password_changed",
    actor: audit.actor(req),
    resource: { type: "user", id: user._id },
  });

  res.json({
    success: true,
    message: "Password updated",
    ...session, // token, refreshToken (for mobile clients), tokenExpiresAt
  });
});

module.exports = updatePassword;
