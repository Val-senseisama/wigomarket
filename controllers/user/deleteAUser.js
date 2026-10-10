const User = require("../../models/userModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const audit = require("../../services/auditService");
const { findBlockers, anonymiseAccount } = require("../../services/accountDeletionService");

/**
 * @function deleteAUser
 * @description Admin deletion of a user. Same outcome as self-deletion
 * (DELETE /api/user/me): the account is anonymised, not removed, so their
 * orders, refunds and ledger entries still resolve; their shop is suspended,
 * products hidden, rider profile suspended and wallet closed.
 *
 * Refused (409) while the user has unfinished orders, open refunds, a wallet
 * balance or a pending withdrawal — deleting then would strand parcels or
 * money. Block the user (PUT /api/user/block-user/:id) to stop them acting in
 * the meantime.
 *
 * @param {string} req.params.id - User ID to delete (required)
 * @returns {Object} - { success, message, data: { _id } }
 */
const deleteAUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const user = await User.findById(id);
  if (!user || user.status === "deleted") {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  const blockers = await findBlockers(user._id);
  if (blockers.length) {
    return res.status(409).json({
      success: false,
      message: "This account cannot be deleted yet",
      data: { blockers },
    });
  }

  const before = { email: user.email, role: user.role };
  const { storeId, dispatchProfileId } = await anonymiseAccount(user);

  audit.log({
    action: "user.deleted",
    actor: audit.actor(req),
    resource: { type: "user", id, displayName: before.email },
    changes: { before },
    metadata: { storeId, dispatchProfileId },
  });

  res.json({ success: true, message: "User deleted", data: { _id: user._id } });
});

module.exports = deleteAUser;
