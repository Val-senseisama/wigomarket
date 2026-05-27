const Store = require("../../models/storeModel");
const User = require("../../models/userModel");
const asyncHandler = require("express-async-handler");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const { storeCreationSuccessTemplate } = require("../../templates/Emails");
const sendEmail = require("../emailController");
const audit = require("../../services/auditService");

/**
 * @function createStore
 * @description Create a new store for a seller.
 *              Both `storeImage` and `ownerNIN` must be Cloudinary URLs — upload
 *              them via POST /api/upload/signature before calling this endpoint.
 * @param {Object} req.body.name          - Store name (required, unique)
 * @param {Object} req.body.address       - Store address (required)
 * @param {string} req.body.storeMobile   - Store contact number (required)
 * @param {string} req.body.storeEmail    - Store contact email (required)
 * @param {string} req.body.storeImage    - Cloudinary URL of the store photo (required)
 * @param {string} req.body.ownerNIN      - Cloudinary URL of the owner NIN image (required)
 * @param {string} req.body.businessType  - Type of business e.g. "Retail" (required)
 * @param {string} req.body.city          - City (required)
 * @param {string} req.body.state         - State (required)
 * @param {string} [req.body.description] - Store description (optional)
 */
const createStore = asyncHandler(async (req, res) => {
  const { _id, mobile, role, email } = req.user;
  const {
    name,
    address,
    storeMobile,
    storeEmail,
    storeImage,
    ownerNIN,
    businessType,
    city,
    state,
    description,
  } = req.body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!Validate.string(name))         ThrowError("Store name is required");
  if (!Validate.string(address))      ThrowError("Store address is required");
  if (!Validate.string(storeMobile))  ThrowError("Store mobile number is required");
  if (!Validate.email(storeEmail))    ThrowError("Invalid store email");
  if (!Validate.string(businessType)) ThrowError("Business type is required");
  if (!Validate.string(city))         ThrowError("City is required");
  if (!Validate.string(state))        ThrowError("State is required");

  if (!Validate.cloudinaryUrl(storeImage)) {
    return res.status(400).json({
      success: false,
      message:
        "storeImage must be a valid Cloudinary URL. Upload the image via POST /api/upload/signature first.",
    });
  }

  if (!Validate.cloudinaryUrl(ownerNIN)) {
    return res.status(400).json({
      success: false,
      message:
        "ownerNIN must be a valid Cloudinary URL. Upload the document image via POST /api/upload/signature first.",
    });
  }

  // ── Uniqueness checks ─────────────────────────────────────────────────────
  const [findStore, userStore] = await Promise.all([
    Store.findOne({ name }, { _id: 1 }),
    Store.findOne({ owner: _id }, { _id: 1 }),
  ]);

  if (userStore) {
    return res.status(400).json({ success: false, message: "You already have a store" });
  }
  if (findStore) {
    return res.status(400).json({ success: false, message: "Store name already taken" });
  }

  // ── Create ────────────────────────────────────────────────────────────────
  try {
    const newStore = await Store.create({
      name,
      mobile: storeMobile ?? mobile,
      email: storeEmail ?? email,
      image: storeImage,
      ownerNIN,
      businessType,
      city,
      state,
      description: description || "",
      owner: _id,
      address,
    });

    if (!role.includes("seller")) {
      await User.findOneAndUpdate(
        { _id },
        { $set: { role: [...role, "seller"] } },
      );
    }

    sendEmail(
      {
        to: email,
        text: `Hello ${name}`,
        subject: "Store Creation - WigoMarket",
        htm: storeCreationSuccessTemplate(name, address),
      },
      true,
    );

    audit.log({
      action: "store.created",
      actor: audit.actor(req),
      resource: { type: "store", id: newStore._id, displayName: name },
      changes: { after: { name, address, email: storeEmail ?? email, businessType, city, state } },
    });

    res.status(201).json({ success: true, data: newStore });
  } catch (error) {
    console.log(error);
    ThrowError(error);
  }
});

module.exports = createStore;
