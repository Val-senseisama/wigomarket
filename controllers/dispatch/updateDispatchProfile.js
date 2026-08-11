const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const { normalizeVehicleType, UI_VEHICLE_TYPES } = require("../../utils/vehicleType");
const { invalidateDispatchProfile } = require("../../utils/dispatchProfileCache");
const { normalizeWorkingDays } = require("../../utils/workingDays");

/**
 * Fields an agent is allowed to edit on their own dispatch profile.
 *
 * Anything not listed here is ignored. `status`, `isActive`, `earnings`,
 * `rating` and `user` are all writable by the schema, so passing req.body
 * straight to findOneAndUpdate let an agent approve themselves
 * (`{"status":"approved","isActive":true}`), invent earnings, or re-point the
 * profile at another user.
 *
 * Leaf paths are listed individually rather than as whole objects because a
 * MongoDB `$set` on a nested object REPLACES it. `{vehicleInfo:{type:"bicycle"}}`
 * became `$set:{vehicleInfo:{type:"bicycle"}}`, wiping make/model/year/
 * plateNumber/color; `{documents:{nin:{number:"…"}}}` wiped the driver-licence
 * and vehicle-registration documents entirely, dropping setupLevel back to 1.
 * Flattening to dot notation touches only the keys the caller actually sent.
 */
const EDITABLE_PATHS = [
  "vehicleInfo.type",
  "vehicleInfo.make",
  "vehicleInfo.model",
  "vehicleInfo.year",
  "vehicleInfo.plateNumber",
  "vehicleInfo.color",
  "availability.status",
  "availability.workingDays",
  "documents.driverLicense.number",
  "documents.driverLicense.expiryDate",
  "documents.driverLicense.image",
  "documents.vehicleRegistration.number",
  "documents.vehicleRegistration.expiryDate",
  "documents.vehicleRegistration.image",
  "documents.nin.number",
  "documents.nin.image",
];

// Replaced wholesale rather than merged — it is an array, so there is no
// per-leaf path to address and the client always sends the full list.
const EDITABLE_ARRAYS = ["coverageAreas"];

/** Read a dot path out of the request body, reporting whether it was present. */
function pick(body, path) {
  const segments = path.split(".");
  let node = body;
  for (const segment of segments) {
    if (node === null || typeof node !== "object" || !(segment in node)) {
      return { present: false };
    }
    node = node[segment];
  }
  return { present: true, value: node };
}

/**
 * @function updateDispatchProfile
 * @description Partial update of the authenticated agent's dispatch profile.
 *              Only the fields present in the body are written; every other
 *              field — including sibling keys inside vehicleInfo and documents —
 *              is left untouched.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Partial profile data
 * @returns {Object} - Updated dispatch profile
 */
const updateDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update dispatch profiles."
    });
  }

  const updates = {};

  for (const path of EDITABLE_PATHS) {
    const { present, value } = pick(req.body, path);
    if (present) updates[path] = value;
  }

  for (const key of EDITABLE_ARRAYS) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  // `workingDays` is stored at availability.workingDays, but POST /profile and
  // the API docs both take it as a top-level key, so the app sends it that way
  // on update too. Mongoose strict mode used to drop the unknown top-level path
  // without a word: the schedule silently never changed and the response echoed
  // the stored days back, which reads as "the API reduced my days". Accept both
  // shapes; the nested form wins if somebody sends both.
  if (req.body.workingDays !== undefined && updates["availability.workingDays"] === undefined) {
    updates["availability.workingDays"] = req.body.workingDays;
  }

  if (updates["availability.workingDays"] !== undefined) {
    const result = normalizeWorkingDays(updates["availability.workingDays"]);
    if (result.error) {
      return res.status(400).json({ success: false, message: result.error });
    }
    updates["availability.workingDays"] = result.days;
  }

  // Normalise the vehicle type (e.g. "motor bike" → "motorcycle") if supplied.
  if (updates["vehicleInfo.type"] !== undefined) {
    const normalized = normalizeVehicleType(updates["vehicleInfo.type"]);
    if (!normalized) {
      return res.status(400).json({
        success: false,
        message: `vehicleInfo.type must be one of: ${UI_VEHICLE_TYPES.join(", ")}`,
      });
    }
    updates["vehicleInfo.type"] = normalized;
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      message: "No editable fields supplied. Editable fields: " +
        [...EDITABLE_PATHS, ...EDITABLE_ARRAYS].join(", "),
    });
  }

  // A re-uploaded document image has not been reviewed yet, so clear the
  // verified flag alongside it — same rule PUT /profile/documents applies.
  if (updates["documents.driverLicense.image"] !== undefined) {
    updates["documents.driverLicense.verified"] = false;
  }
  if (updates["documents.vehicleRegistration.image"] !== undefined) {
    updates["documents.vehicleRegistration.verified"] = false;
  }
  if (updates["documents.nin.image"] !== undefined) {
    updates["documents.nin.verified"] = false;
  }

  try {
    const dispatchProfile = await DispatchProfile.findOneAndUpdate(
      { user: _id },
      updates,
      { new: true, runValidators: true }
    );

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Dispatch profile not found"
      });
    }

    // GET /profile serves a 60 s cache — without this the agent keeps reading
    // the pre-update profile back after a successful save.
    await invalidateDispatchProfile(_id);

    res.json({
      success: true,
      message: "Dispatch profile updated successfully",
      data: dispatchProfile
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to update dispatch profile");
  }

});

module.exports = updateDispatchProfile;
