const User = require("../../models/userModel");
const asyncHandler = require("express-async-handler");
const Validate = require("../../Helpers/Validate");
const audit = require("../../services/auditService");
const { findBlockers, anonymiseAccount } = require("../../services/accountDeletionService");

/**
 * Re-authenticate the caller before an irreversible action. A bearer token
 * alone is not enough: it may be a stolen or left-signed-in session.
 *
 * Password accounts confirm with their password. Google accounts have no
 * password, so they confirm with a fresh Firebase ID token for the same uid.
 *
 * @returns {Promise<string|null>} an error message, or null when confirmed
 */
const confirmIdentity = async (user, { password, idToken }) => {
  if (user.firebaseUid && Validate.string(idToken)) {
    try {
      const admin = require("firebase-admin");
      const decoded = await admin.auth().verifyIdToken(idToken);
      return decoded.uid === user.firebaseUid ? null : "Google account does not match";
    } catch (error) {
      return "Invalid Google ID token";
    }
  }

  if (!Validate.string(password)) {
    return user.firebaseUid
      ? "Confirm with your password or a fresh Google idToken"
      : "Password is required to delete your account";
  }
  if (!user.password || !(await user.isPasswordMatched(password))) {
    return "Incorrect password";
  }
  return null;
};

/**
 * @function deleteMyAccount
 * @description Lets the signed-in user delete their own account. Refused (409)
 * while orders, refunds or wallet funds are outstanding. On success the
 * account is anonymised, its store/products/rider profile are switched off and
 * every session stops working.
 * @param {string} req.body.password - current password (password accounts)
 * @param {string} req.body.idToken - fresh Firebase ID token (Google accounts)
 * @param {string} [req.body.reason] - optional free-text reason, kept in the audit log
 */
const deleteMyAccount = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const identityError = await confirmIdentity(user, req.body || {});
  if (identityError) {
    return res.status(401).json({ success: false, message: identityError });
  }

  const blockers = await findBlockers(user._id);
  if (blockers.length) {
    return res.status(409).json({
      success: false,
      message: "Your account cannot be deleted yet",
      data: { blockers },
    });
  }

  const before = { email: user.email, role: user.role };
  const { storeId, dispatchProfileId } = await anonymiseAccount(user);

  audit.log({
    action: "user.self_deleted",
    actor: audit.actor(req),
    resource: { type: "user", id: user._id, displayName: before.email },
    changes: { before },
    metadata: {
      storeId,
      dispatchProfileId,
      ...(Validate.string(req.body?.reason) && { reason: req.body.reason.slice(0, 500) }),
    },
  });

  res.clearCookie("refreshToken", { httpOnly: true, secure: true });
  res.json({ success: true, message: "Your account has been deleted" });
});

module.exports = deleteMyAccount;
