const User = require("../../models/userModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const audit = require("../../services/auditService");

/**
 * @function unblockUser
 * @description Unblocks a user by setting their isBlocked status to false
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - User ID to unblock (required)
 * @returns {Object} - Updated user information with unblocked status
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const unblockUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  try {
    const unblock = await User.findByIdAndUpdate(
      id,
      {
        isBlocked: false,
      },
      {
        new: true,
      },
    );
    audit.log({
      action: "user.unblocked",
      actor: audit.actor(req),
      resource: { type: "user", id, displayName: unblock?.email },
      changes: { before: { isBlocked: true }, after: { isBlocked: false } },
    });
    res.json(unblock);
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = unblockUser;
