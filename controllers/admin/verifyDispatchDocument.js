const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

const VALID_DOCS = ["driverLicense", "vehicleRegistration", "nin"];

/**
 * @function verifyDispatchDocument
 * @description Mark a single rider document as verified / unverified after the
 *   admin has reviewed the uploaded image.
 * @access Admin only
 *
 * Params: :id (profile), :docType (driverLicense | vehicleRegistration | nin)
 * Body:   { verified: true }
 */
const verifyDispatchDocument = asyncHandler(async (req, res) => {
  const { id, docType } = req.params;
  const { verified = true } = req.body;
  validateMongodbId(id);

  if (!VALID_DOCS.includes(docType)) {
    res.status(400);
    throw new Error(`docType must be one of: ${VALID_DOCS.join(", ")}`);
  }

  const profile = await DispatchProfile.findById(id);
  if (!profile) {
    res.status(404);
    throw new Error("Dispatch profile not found");
  }

  if (!profile.documents?.[docType]?.image) {
    res.status(400);
    throw new Error(`No ${docType} document uploaded for this rider`);
  }

  profile.documents[docType].verified = !!verified;
  await profile.save();

  audit.log({
    action: "admin.dispatch.document_verified",
    actor: audit.actor(req),
    resource: { type: "dispatchProfile", id: profile._id },
    metadata: { docType, verified: !!verified },
  });

  res.json({
    success: true,
    message: `${docType} marked as ${verified ? "verified" : "unverified"}`,
    data: { documents: profile.documents },
  });
});

module.exports = verifyDispatchDocument;
