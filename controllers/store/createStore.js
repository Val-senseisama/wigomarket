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
 * @description Create a new store for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} req.user - Authenticated user information
 * @param {string} req.user._id - User ID
 * @param {string} req.user.mobile - User's mobile number
 * @param {string} req.user.email - User's email
 * @param {string[]} req.user.role - User's roles
 * @param {Object} req.body - Store creation data
 * @param {string} req.body.name - Store name (required)
 * @param {string} req.body.address - Store address (required)
 * @param {string} req.body.storeMobile - Store mobile number (required)
 * @param {string} req.body.storeEmail - Store email (required)
 * @param {string} req.body.storeImage - Store image URL (required)
 * @returns {Object} - Created store information
 * @throws {Error} - Throws error if validation fails, store already exists, or creation fails
 */
const createStore = asyncHandler(async (req, res) => {
  const { _id, mobile, role, email } = req.user;
  const { name, address, storeMobile, storeEmail, storeImage } = req.body;

  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }

  if (!Validate.string(address)) {
    ThrowError("Invalid Address");
  }

  if (!Validate.string(mobile)) {
    ThrowError("Invalid Mobile Number");
  }

  if (!Validate.string(storeMobile)) {
    ThrowError("Invalid Store Mobile Number");
  }

  if (!Validate.email(storeEmail)) {
    ThrowError("Invalid Store Email");
  }

  if (!Validate.string(storeImage)) {
    ThrowError("Invalid Store Image");
  }
  try {
    const [findStore, userStore] = await Promise.all([
      Store.findOne({ name }, { _id: 1 }),
      Store.findOne({ owner: _id }, { _id: 1 }),
    ]);

    if (userStore) {
      return res
        .status(400)
        .json({ success: false, message: "You already have a store" });
    }
    if (findStore) {
      return res
        .status(400)
        .json({ success: false, message: "Store name already taken" });
    }

    const newStore = await Store.create({
      name,
      mobile: storeMobile ?? mobile,
      email: storeEmail ?? email,
      image: storeImage,
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
      changes: { after: { name, address, email: storeEmail ?? email } },
    });

    res.json(newStore);
  } catch (error) {
    console.log(error);
    ThrowError(error);
  }
});

module.exports = createStore;
