const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function createDispatchProfile
 * @description Create the dispatch profile for a verified delivery agent.
 *              All three document images (driverLicense, vehicleRegistration, nin)
 *              must be Cloudinary URLs — upload them via POST /api/upload/signature
 *              (folder: "dispatch-documents") before calling this endpoint.
 * @param {Object}   req.body.vehicleInfo               - Vehicle details (required)
 * @param {Object}   req.body.documents                 - Document details (required)
 * @param {string}   req.body.documents.driverLicense.number
 * @param {string}   req.body.documents.driverLicense.expiryDate  - ISO date string
 * @param {string}   req.body.documents.driverLicense.image       - Cloudinary URL
 * @param {string}   req.body.documents.vehicleRegistration.number
 * @param {string}   req.body.documents.vehicleRegistration.expiryDate
 * @param {string}   req.body.documents.vehicleRegistration.image  - Cloudinary URL
 * @param {string}   req.body.documents.nin.number
 * @param {string}   req.body.documents.nin.image                  - Cloudinary URL
 * @param {string[]} [req.body.coverageAreas]
 * @param {string[]} [req.body.workingDays]
 */
const createDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { vehicleInfo, coverageAreas, documents, workingDays } = req.body;

  // ── Role guard ────────────────────────────────────────────────────────────
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can create dispatch profiles.",
    });
  }

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

  // ── documents validation ──────────────────────────────────────────────────
  if (!documents || typeof documents !== "object") {
    return res.status(400).json({ success: false, message: "documents is required" });
  }

  const { driverLicense, vehicleRegistration, nin } = documents;

  // Driver license
  if (!driverLicense?.number)      return res.status(400).json({ success: false, message: "documents.driverLicense.number is required" });
  if (!driverLicense?.expiryDate)  return res.status(400).json({ success: false, message: "documents.driverLicense.expiryDate is required" });
  if (!Validate.cloudinaryUrl(driverLicense?.image)) {
    return res.status(400).json({
      success: false,
      message:
        "documents.driverLicense.image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: dispatch-documents).",
    });
  }

  // Vehicle registration
  if (!vehicleRegistration?.number)     return res.status(400).json({ success: false, message: "documents.vehicleRegistration.number is required" });
  if (!vehicleRegistration?.expiryDate) return res.status(400).json({ success: false, message: "documents.vehicleRegistration.expiryDate is required" });
  if (!Validate.cloudinaryUrl(vehicleRegistration?.image)) {
    return res.status(400).json({
      success: false,
      message:
        "documents.vehicleRegistration.image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: dispatch-documents).",
    });
  }

  // NIN
  if (!nin?.number) return res.status(400).json({ success: false, message: "documents.nin.number is required" });
  if (!Validate.cloudinaryUrl(nin?.image)) {
    return res.status(400).json({
      success: false,
      message:
        "documents.nin.image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: dispatch-documents).",
    });
  }

  // ── Create ────────────────────────────────────────────────────────────────
  try {
    const dispatchProfile = await DispatchProfile.create({
      user: _id,
      vehicleInfo: { type, make, model, year, plateNumber, color },
      coverageAreas: coverageAreas || [],
      documents: {
        driverLicense: {
          number: driverLicense.number,
          expiryDate: driverLicense.expiryDate,
          image: driverLicense.image,
        },
        vehicleRegistration: {
          number: vehicleRegistration.number,
          expiryDate: vehicleRegistration.expiryDate,
          image: vehicleRegistration.image,
        },
        nin: {
          number: nin.number,
          image: nin.image,
        },
      },
      availability: {
        workingDays: workingDays || ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
      status: "pending",
    });

    res.status(201).json({
      success: true,
      message: "Dispatch profile created successfully. Documents are under review.",
      data: dispatchProfile,
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to create dispatch profile");
  }
});

module.exports = createDispatchProfile;
