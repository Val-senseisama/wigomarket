const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const { Validate } = require("../../Helpers/Validate");

/**
 * @function createDispatchProfile
 * @description Create the dispatch profile for a verified delivery agent.
 *
 *   This is STEP 1 of the onboarding flow — only vehicle info is required.
 *   After creation, the agent completes setup via two additional endpoints:
 *     PUT /api/delivery-agent/profile/documents  (step 2)
 *     PUT /api/delivery-agent/profile/payment    (step 3)
 *
 *   The returned `setupLevel` and `setupSteps` fields show onboarding progress.
 *
 * @param {Object}   req.body.vehicleInfo               - Vehicle details (required)
 * @param {string[]} [req.body.coverageAreas]           - Service areas (optional)
 * @param {string[]} [req.body.workingDays]             - Working days (optional)
 * @param {Object}   [req.body.documents]               - Documents (optional at creation)
 */
const createDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { vehicleInfo, coverageAreas, documents, workingDays } = req.body;

  // ── Duplicate check ───────────────────────────────────────────────────────
  const existingProfile = await DispatchProfile.findOne({ user: _id });
  if (existingProfile) {
    return res.status(400).json({
      success: false,
      message: "Dispatch profile already exists for this user",
    });
  }

  // ── vehicleInfo validation ────────────────────────────────────────────────
  if (!vehicleInfo || typeof vehicleInfo !== "object") {
    return res.status(400).json({ success: false, message: "vehicleInfo is required" });
  }
  const { type, make, model, year, plateNumber, color } = vehicleInfo;
  if (!Validate.string(type))        return res.status(400).json({ success: false, message: "vehicleInfo.type is required" });
  if (!Validate.string(make))        return res.status(400).json({ success: false, message: "vehicleInfo.make is required" });
  if (!Validate.string(model))       return res.status(400).json({ success: false, message: "vehicleInfo.model is required" });
  if (!Validate.integer(year))       return res.status(400).json({ success: false, message: "vehicleInfo.year must be an integer" });
  if (!Validate.string(plateNumber)) return res.status(400).json({ success: false, message: "vehicleInfo.plateNumber is required" });
  if (!Validate.string(color))       return res.status(400).json({ success: false, message: "vehicleInfo.color is required" });

  // ── Documents — optional at creation, validated if provided ──────────────
  let validatedDocuments = {};
  if (documents) {
    const { driverLicense, vehicleRegistration, nin } = documents;

    if (driverLicense) {
      if (!driverLicense.number)     return res.status(400).json({ success: false, message: "documents.driverLicense.number is required when providing driverLicense" });
      if (!driverLicense.expiryDate) return res.status(400).json({ success: false, message: "documents.driverLicense.expiryDate is required when providing driverLicense" });
      if (driverLicense.image && !Validate.cloudinaryUrl(driverLicense.image)) {
        return res.status(400).json({ success: false, message: "documents.driverLicense.image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: dispatch-documents)." });
      }
      validatedDocuments.driverLicense = {
        number: driverLicense.number,
        expiryDate: driverLicense.expiryDate,
        image: driverLicense.image || null,
      };
    }

    if (vehicleRegistration) {
      if (!vehicleRegistration.number)     return res.status(400).json({ success: false, message: "documents.vehicleRegistration.number is required when providing vehicleRegistration" });
      if (!vehicleRegistration.expiryDate) return res.status(400).json({ success: false, message: "documents.vehicleRegistration.expiryDate is required when providing vehicleRegistration" });
      if (vehicleRegistration.image && !Validate.cloudinaryUrl(vehicleRegistration.image)) {
        return res.status(400).json({ success: false, message: "documents.vehicleRegistration.image must be a valid Cloudinary URL." });
      }
      validatedDocuments.vehicleRegistration = {
        number: vehicleRegistration.number,
        expiryDate: vehicleRegistration.expiryDate,
        image: vehicleRegistration.image || null,
      };
    }

    if (nin) {
      if (!nin.number) return res.status(400).json({ success: false, message: "documents.nin.number is required when providing nin" });
      if (nin.image && !Validate.cloudinaryUrl(nin.image)) {
        return res.status(400).json({ success: false, message: "documents.nin.image must be a valid Cloudinary URL." });
      }
      validatedDocuments.nin = {
        number: nin.number,
        image: nin.image || null,
      };
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────
  try {
    const dispatchProfile = await DispatchProfile.create({
      user: _id,
      vehicleInfo: { type, make, model, year, plateNumber, color },
      coverageAreas: coverageAreas || [],
      documents: validatedDocuments,
      availability: {
        workingDays: workingDays || ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Dispatch profile created. Complete setup by uploading documents and adding payment info.",
      data: dispatchProfile,
    });
  } catch (error) {
    throw new Error(error.message || "Failed to create dispatch profile");
  }
});

module.exports = createDispatchProfile;
