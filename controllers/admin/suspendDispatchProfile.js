const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function suspendDispatchProfile
 * @description Suspend a previously approved rider, taking them offline.
 * @access Admin only
 *
 * Body: { reason: "..." }
 */
const suspendDispatchProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  validateMongodbId(id);

  const profile = await DispatchProfile.findById(id);
  if (!profile) {
    res.status(404);
    throw new Error("Dispatch profile not found");
  }

  const before = { status: profile.status, isActive: profile.isActive };
  profile.status = "suspended";
  profile.isActive = false;
  profile.availability.status = "offline";
  await profile.save();

  audit.log({
    action: "admin.dispatch.suspended",
    actor: audit.actor(req),
    resource: { type: "dispatchProfile", id: profile._id },
    changes: { before, after: { status: profile.status, isActive: profile.isActive } },
    metadata: { reason },
  });

  res.json({
    success: true,
    message: "Dispatch profile suspended",
    data: profile,
  });
});

module.exports = suspendDispatchProfile;
