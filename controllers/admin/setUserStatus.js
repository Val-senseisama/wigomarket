const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

const VALID_STATUSES = ["active", "pending", "blocked"];

/**
 * @function setUserStatus
 * @description Set a user's account status. Keeps the legacy isBlocked flag in
 *   sync (blocked => isBlocked true, otherwise false) so authMiddleware checks
 *   stay consistent.
 * @access Admin only
 *
 * Body: { status: "blocked", reason?: "..." }
 */
const setUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  validateMongodbId(id);

  if (!VALID_STATUSES.includes(status)) {
    res.status(400);
    throw new Error(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const user = await User.findById(id).select("status isBlocked email");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const before = { status: user.status, isBlocked: user.isBlocked };
  // findByIdAndUpdate avoids the userModel pre-save hook, which re-hashes the
  // password on every .save() and would otherwise lock the user out.
  const updated = await User.findByIdAndUpdate(
    id,
    { status, isBlocked: status === "blocked" },
    { new: true },
  ).select("status isBlocked email");

  audit.log({
    action: "admin.user.status_changed",
    actor: audit.actor(req),
    resource: { type: "user", id: updated._id, displayName: updated.email },
    changes: { before, after: { status: updated.status, isBlocked: updated.isBlocked } },
    metadata: { reason },
  });

  res.json({
    success: true,
    message: `User status set to ${status}`,
    data: { _id: updated._id, status: updated.status, isBlocked: updated.isBlocked },
  });
});

module.exports = setUserStatus;
