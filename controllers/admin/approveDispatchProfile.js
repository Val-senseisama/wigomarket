const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function approveDispatchProfile
 * @description Approve a rider so they can start taking deliveries. Requires the
 *   onboarding to be complete (setupLevel 3: documents + payment info present).
 * @access Admin only
 */
const approveDispatchProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const profile = await DispatchProfile.findById(id);
  if (!profile) {
    res.status(404);
    throw new Error("Dispatch profile not found");
  }

  if (profile.setupLevel < 3) {
    res.status(400);
    throw new Error(
      "Rider has not completed onboarding (documents and payment info required)",
    );
  }

  const before = { status: profile.status, isActive: profile.isActive };
  profile.status = "approved";
  profile.isActive = true;
  await profile.save();

  audit.log({
    action: "admin.dispatch.approved",
    actor: audit.actor(req),
    resource: { type: "dispatchProfile", id: profile._id },
    changes: { before, after: { status: profile.status, isActive: profile.isActive } },
  });

  res.json({
    success: true,
    message: "Dispatch profile approved",
    data: profile,
  });
});

module.exports = approveDispatchProfile;
