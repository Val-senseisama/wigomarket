const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const { issueEmailChangeCode } = require("./emailChangeCode");

// Minimum gap between two codes for the same pending change.
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * @function resendEmailChangeCode
 * @description Sends a fresh code for the email change started by
 * PUT /api/user/edit-user, to the same pending address. The previous code stops
 * working and the 15-minute expiry restarts. At most one code per minute.
 * @returns {Object} - { success, message, data: { pendingEmail } }
 */
const resendEmailChangeCode = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id, "firstname fullName pendingEmail");
  if (!user?.pendingEmail) {
    return res.status(400).json({ success: false, message: "No email change is pending" });
  }

  const existing = await Token.findOne({ email: user.pendingEmail }, "createdAt");
  const elapsed = existing ? Date.now() - existing.createdAt.getTime() : Infinity;
  if (elapsed < RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({
      success: false,
      message: `Please wait ${retryAfter}s before requesting another code`,
      retryAfter,
    });
  }

  await issueEmailChangeCode(user, user.pendingEmail);

  res.json({
    success: true,
    message: `A new code has been sent to ${user.pendingEmail}`,
    data: { pendingEmail: user.pendingEmail },
  });
});

module.exports = resendEmailChangeCode;
