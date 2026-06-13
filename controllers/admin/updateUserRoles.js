const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

const VALID_ROLES = ["seller", "buyer", "dispatch", "admin"];

/**
 * @function updateUserRoles
 * @description Replace a user's role array. Validates against the schema enum.
 *   If the user's current activeRole is removed, it falls back to the first
 *   remaining role.
 * @access Admin only
 *
 * Body: { roles: ["buyer", "seller"] }
 */
const updateUserRoles = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { roles } = req.body;
  validateMongodbId(id);

  if (!Array.isArray(roles) || roles.length === 0) {
    res.status(400);
    throw new Error("roles must be a non-empty array");
  }

  const invalid = roles.filter((r) => !VALID_ROLES.includes(r));
  if (invalid.length > 0) {
    res.status(400);
    throw new Error(`Invalid role(s): ${invalid.join(", ")}`);
  }

  const user = await User.findById(id).select("role activeRole email");
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const before = { role: user.role, activeRole: user.activeRole };
  const dedupedRoles = [...new Set(roles)];
  // If the current activeRole is no longer granted, fall back to the first role.
  const activeRole = dedupedRoles.includes(user.activeRole)
    ? user.activeRole
    : dedupedRoles[0];

  // findByIdAndUpdate avoids the userModel pre-save hook, which re-hashes the
  // password on every .save() and would otherwise lock the user out.
  const updated = await User.findByIdAndUpdate(
    id,
    { role: dedupedRoles, activeRole },
    { new: true },
  ).select("role activeRole email");

  audit.log({
    action: "admin.user.roles_updated",
    actor: audit.actor(req),
    resource: { type: "user", id: updated._id, displayName: updated.email },
    changes: { before, after: { role: updated.role, activeRole: updated.activeRole } },
  });

  res.json({
    success: true,
    message: "User roles updated",
    data: { _id: updated._id, role: updated.role, activeRole: updated.activeRole },
  });
});

module.exports = updateUserRoles;
