const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const Validate = require("../../Helpers/Validate");
const audit = require("../../services/auditService");

/**
 * @function verifyEmailChange
 * @description Completes an email change started by PUT /api/user/edit-user.
 * The code was sent to the new address, so entering it proves the user owns it.
 * @param {string} req.body.code - the 6-digit code (required)
 * @returns {Object} - { success, message, data: { email } }
 */
const verifyEmailChange = asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (!Validate.string(code)) {
    return res.status(400).json({ success: false, message: "Invalid code" });
  }

  const user = await User.findById(req.user._id, "email pendingEmail");
  if (!user?.pendingEmail) {
    return res.status(400).json({ success: false, message: "No email change is pending" });
  }

  const token = await Token.findOne({ email: user.pendingEmail });
  if (!token) {
    return res.status(400).json({ success: false, message: "Code expired. Request the change again." });
  }
  if (token.code !== code.trim()) {
    return res.status(400).json({ success: false, message: "Invalid code" });
  }

  const previousEmail = user.email;
  const newEmail = user.pendingEmail;

  try {
    await User.updateOne(
      { _id: user._id, pendingEmail: newEmail },
      { $set: { email: newEmail }, $unset: { pendingEmail: 1 } },
    );
  } catch (error) {
    // Someone registered this address after the change was requested.
    if (error?.code === 11000) {
      await User.updateOne({ _id: user._id }, { $unset: { pendingEmail: 1 } });
      return res.status(409).json({ success: false, message: "Email already in use" });
    }
    throw error;
  }

  await Token.deleteOne({ _id: token._id });

  audit.log({
    action: "user.email_changed",
    actor: audit.actor(req),
    resource: { type: "user", id: user._id, displayName: newEmail },
    changes: { before: { email: previousEmail }, after: { email: newEmail } },
  });

  res.json({ success: true, message: "Email updated", data: { email: newEmail } });
});

module.exports = verifyEmailChange;
