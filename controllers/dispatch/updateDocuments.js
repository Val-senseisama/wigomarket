const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const { Validate } = require("../../Helpers/Validate");
const redisClient = require("../../config/redisClient");

/**
 * @function updateDocuments
 * @description STEP 2 of onboarding — upload / replace vehicle and identity
 *              document images on the dispatch profile.
 *
 *   All three image fields must be valid Cloudinary URLs — upload them first via
 *   POST /api/upload/signature (folder: dispatch-documents).
 *
 * @body {Object} driverLicense        - { number, expiryDate, image }
 * @body {Object} vehicleRegistration  - { number, expiryDate, image }
 * @body {Object} nin                  - { number, image }
 */
const updateDocuments = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { driverLicense, vehicleRegistration, nin } = req.body;

  // ── Validate required presence ────────────────────────────────────────────
  if (!driverLicense || !vehicleRegistration || !nin) {
    return res.status(400).json({
      success: false,
      message: "driverLicense, vehicleRegistration, and nin are all required",
    });
  }

  // ── Driver license ────────────────────────────────────────────────────────
  if (!driverLicense.number) {
    return res.status(400).json({ success: false, message: "driverLicense.number is required" });
  }
  if (!driverLicense.expiryDate) {
    return res.status(400).json({ success: false, message: "driverLicense.expiryDate is required" });
  }
  if (!Validate.cloudinaryUrl(driverLicense.image)) {
    return res.status(400).json({
      success: false,
      message: "driverLicense.image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: dispatch-documents).",
    });
  }

  // ── Vehicle registration ──────────────────────────────────────────────────
  if (!vehicleRegistration.number) {
    return res.status(400).json({ success: false, message: "vehicleRegistration.number is required" });
  }
  if (!vehicleRegistration.expiryDate) {
    return res.status(400).json({ success: false, message: "vehicleRegistration.expiryDate is required" });
  }
  if (!Validate.cloudinaryUrl(vehicleRegistration.image)) {
    return res.status(400).json({
      success: false,
      message: "vehicleRegistration.image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: dispatch-documents).",
    });
  }

  // ── NIN ───────────────────────────────────────────────────────────────────
  if (!nin.number) {
    return res.status(400).json({ success: false, message: "nin.number is required" });
  }
  if (!Validate.cloudinaryUrl(nin.image)) {
    return res.status(400).json({
      success: false,
      message: "nin.image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: dispatch-documents).",
    });
  }

  // ── Update (dot notation to avoid overwriting other fields) ───────────────
  const updated = await DispatchProfile.findOneAndUpdate(
    { user: _id },
    {
      "documents.driverLicense.number":           driverLicense.number,
      "documents.driverLicense.expiryDate":        driverLicense.expiryDate,
      "documents.driverLicense.image":             driverLicense.image,
      "documents.driverLicense.verified":          false, // reset on re-upload
      "documents.vehicleRegistration.number":      vehicleRegistration.number,
      "documents.vehicleRegistration.expiryDate":  vehicleRegistration.expiryDate,
      "documents.vehicleRegistration.image":       vehicleRegistration.image,
      "documents.vehicleRegistration.verified":    false,
      "documents.nin.number":                      nin.number,
      "documents.nin.image":                       nin.image,
      "documents.nin.verified":                    false,
    },
    { new: true, runValidators: false },
  );

  if (!updated) {
    return res.status(404).json({ success: false, message: "Dispatch profile not found. Create your profile first." });
  }

  // Invalidate profile cache
  try { await redisClient.del(`dispatch:profile:${_id}`); } catch (_) {}

  res.json({
    success: true,
    message: "Documents uploaded. They will be reviewed by our team.",
    data: {
      setupLevel: updated.setupLevel,
      setupSteps: updated.setupSteps,
      documents: updated.documents,
    },
  });
});

module.exports = updateDocuments;
