const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const Validate = require("../../Helpers/Validate");
const audit = require("../../services/auditService");

const TEXT_FIELDS = ["name", "businessType", "city", "state"];
const NAME_MAX = 80;
const DESCRIPTION_MAX = 1000;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @function updateMyStore
 * @description Partial edit of the seller's own shop details. Only the fields
 * sent change; at least one is required. The address is not edited here — it
 * goes through PUT /api/store/update-location, which geocodes it. NIN and bank
 * details have their own flows and are ignored.
 * @param {string} [req.body.name] - must be unique (case-insensitive)
 * @param {string} [req.body.description] - may be "" to clear it
 * @param {string} [req.body.image] - Cloudinary URL
 * @param {string} [req.body.email] - shop contact email, unique
 * @param {string} [req.body.mobile] - shop contact number, unique
 * @param {string} [req.body.businessType]
 * @param {string} [req.body.city]
 * @param {string} [req.body.state]
 * @returns {Object} - { success, message, data: store }
 */
const updateMyStore = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const storeId = req.store;
  if (!storeId) {
    return res.status(404).json({ success: false, message: "No store found for this account" });
  }

  const bad = (message) => res.status(400).json({ success: false, message });
  const $set = {};

  for (const field of TEXT_FIELDS) {
    if (body[field] === undefined) continue;
    if (!Validate.string(body[field])) return bad(`Invalid ${field}`);
    $set[field] = body[field].trim();
  }
  if ($set.name && $set.name.length > NAME_MAX) {
    return bad(`name must be at most ${NAME_MAX} characters`);
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") return bad("Invalid description");
    if (body.description.trim().length > DESCRIPTION_MAX) {
      return bad(`description must be at most ${DESCRIPTION_MAX} characters`);
    }
    $set.description = body.description.trim();
  }

  if (body.image !== undefined) {
    if (!Validate.cloudinaryUrl(body.image)) {
      return bad("image must be a valid Cloudinary URL. Upload via POST /api/upload/signature first.");
    }
    $set.image = body.image;
  }

  if (body.email !== undefined) {
    if (!Validate.string(body.email) || !Validate.email(body.email.trim())) return bad("Invalid email");
    $set.email = body.email.trim().toLowerCase();
  }

  if (body.mobile !== undefined) {
    if (!Validate.string(body.mobile)) return bad("Invalid mobile");
    $set.mobile = Validate.formatPhone(body.mobile.trim());
  }

  if (!Object.keys($set).length) return bad("No store fields to update");

  // Friendly errors for the unique fields; the unique indexes still back them.
  const others = { _id: { $ne: storeId } };
  const [nameTaken, emailTaken, mobileTaken] = await Promise.all([
    $set.name && Store.exists({ ...others, name: new RegExp(`^${escapeRegex($set.name)}$`, "i") }),
    $set.email && Store.exists({ ...others, email: $set.email }),
    $set.mobile && Store.exists({ ...others, mobile: $set.mobile }),
  ]);
  if (nameTaken) return bad("Store name already taken");
  if (emailTaken) return bad("Store email already in use");
  if (mobileTaken) return bad("Store mobile number already in use");

  let store;
  try {
    store = await Store.findByIdAndUpdate(storeId, { $set }, { new: true, runValidators: true });
  } catch (error) {
    if (error?.code === 11000) return bad("Store name, email or mobile already in use");
    throw error;
  }

  audit.log({
    action: "store.updated",
    actor: audit.actor(req),
    resource: { type: "store", id: storeId, displayName: store?.name },
    changes: { after: $set },
  });

  res.json({ success: true, message: "Store updated", data: store });
});

module.exports = updateMyStore;
