const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const sendEmail = require("../../controllers/emailController");
const Validate = require("../../Helpers/Validate");
const { MakeID } = require("../../Helpers/Helpers");
const { verificationCodeTemplate } = require("../../templates/Emails");
const audit = require("../../services/auditService");

// Plain-text fields a user may edit on themselves. Anything else in the body
// (role, status, password, wallet...) is ignored.
const TEXT_FIELDS = ["firstname", "lastname", "fullName", "mobile", "address", "nickname"];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @function updateAUser
 * @description Partial update of the signed-in user's profile. Only the fields
 * sent are validated and changed; at least one is required.
 *
 * An email change is not applied directly: the new address is stored as
 * `pendingEmail` and a 6-digit code is sent to it. The change takes effect via
 * POST /api/user/verify-email-change.
 *
 * @param {string} [req.body.firstname]
 * @param {string} [req.body.lastname]
 * @param {string} [req.body.fullName]
 * @param {string} [req.body.email] - starts an email change
 * @param {string} [req.body.mobile]
 * @param {string} [req.body.address]
 * @param {string} [req.body.image] - Cloudinary URL
 * @param {string} [req.body.nickname]
 * @returns {Object} - the updated user (same shape as before) plus
 *   `emailChangePending` and `message`
 */
const updateAUser = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const userId = req.user._id;
  const $set = {};

  for (const field of TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    if (!Validate.string(body[field])) {
      return res.status(400).json({ success: false, message: `Invalid ${field}` });
    }
    $set[field] = body[field].trim();
  }

  if (body.image !== undefined) {
    if (!Validate.cloudinaryUrl(body.image)) {
      return res.status(400).json({
        success: false,
        message:
          "image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: profiles).",
      });
    }
    $set.image = body.image;
  }

  let newEmail = null;
  if (body.email !== undefined) {
    if (!Validate.email(body.email)) {
      return res.status(400).json({ success: false, message: "Invalid email" });
    }
    const normalised = body.email.trim().toLowerCase();
    if (normalised !== String(req.user.email).toLowerCase()) newEmail = normalised;
  }

  if (!Object.keys($set).length && body.email === undefined) {
    return res.status(400).json({ success: false, message: "No profile fields to update" });
  }

  if ($set.mobile) {
    const taken = await User.exists({ mobile: $set.mobile, _id: { $ne: userId } });
    if (taken) {
      return res.status(400).json({ success: false, message: "Mobile number already exists" });
    }
  }

  if (newEmail) {
    const taken = await User.exists({
      email: new RegExp(`^${escapeRegex(newEmail)}$`, "i"),
      _id: { $ne: userId },
    });
    if (taken) {
      return res.status(400).json({ success: false, message: "Email already in use" });
    }
    $set.pendingEmail = newEmail;
  }

  const updatedUser = await User.findByIdAndUpdate(userId, { $set }, { new: true });

  if (newEmail) {
    const code = MakeID(6);
    // One outstanding code per address. Replacing createdAt restarts the TTL.
    await Token.findOneAndUpdate(
      { email: newEmail },
      { email: newEmail, code, verified: false, sessionHash: null, createdAt: new Date() },
      { upsert: true },
    );
    sendEmail(
      {
        to: newEmail,
        text: "",
        subject: "Confirm your new email - WigoMarket",
        htm: verificationCodeTemplate(updatedUser.firstname || updatedUser.fullName || "User", code),
      },
      true,
    );
  }

  const { pendingEmail, ...changed } = $set;
  audit.log({
    action: "user.updated",
    actor: audit.actor(req),
    resource: { type: "user", id: userId, displayName: updatedUser?.email },
    changes: { after: changed },
    metadata: newEmail ? { emailChangeRequested: true } : {},
  });

  // The user at the top level, as this endpoint has always returned it.
  res.json({
    ...updatedUser.toJSON(),
    emailChangePending: Boolean(newEmail),
    message: newEmail
      ? `Profile updated. Enter the code sent to ${newEmail} to confirm your new email.`
      : "Profile updated",
  });
});

module.exports = updateAUser;
