const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function rejectDispatchProfile
 * @description Reject a rider application. A reason should be provided so the
 *   rider can be told what to fix.
 * @access Admin only
 *
 * Body: { reason: "..." }
 */
const rejectDispatchProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  validateMongodbId(id);

  const profile = await DispatchProfile.findById(id);
  if (!profile) {
    res.status(404);
    throw new Error("Dispatch profile not found");
  }

  const before = { status: profile.status, isActive: profile.isActive };
  profile.status = "rejected";
  profile.isActive = false;
  await profile.save();

  audit.log({
    action: "admin.dispatch.rejected",
    actor: audit.actor(req),
    resource: { type: "dispatchProfile", id: profile._id },
    changes: { before, after: { status: profile.status, isActive: profile.isActive } },
    metadata: { reason },
  });

  res.json({
    success: true,
    message: "Dispatch profile rejected",
    data: profile,
  });
});

module.exports = rejectDispatchProfile;
