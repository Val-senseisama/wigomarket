const User = require("../../models/userModel");
const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const { generateToken } = require("../../config/jwt");
const validateMongodbId = require("../../utils/validateMongodbId");
const { generateRefreshToken } = require("../../config/refreshToken");
const jwt = require("jsonwebtoken");
const sendEmail = require("../../controllers/emailController");
const crypto = require("crypto");
const Cart = require("../../models/cartModel");
const Validate = require("../../Helpers/Validate");
const Order = require("../../models/orderModel");
const Product = require("../../models/productModel");
const Store = require("../../models/storeModel");
const uniqid = require("uniqid");
const { ThrowError, MakeID } = require("../../Helpers/Helpers");
const audit = require("../../services/auditService");

/**
 * @function updateAUser
 * @description Updates user profile information
 * @param {Object} req - Express request object containing user data
 * @param {Object} res - Express response object
 * @param {string} req.user.id - Authenticated user's ID (required)
 * @param {string} req.body.firstname - User's first name
 * @param {string} req.body.lastname - User's last name
 * @param {string} req.body.email - User's email address
 * @param {string} req.body.mobile - User's mobile number
 * @param {string} req.body.address - User's address
 * @param {string} req.body.image - User's profile image
 * @param {string} req.body.nickname - User's nickname
 * @returns {Object} - Updated user information
 * @throws {Error} - Throws error if validation fails or mobile number already exists
 */
const updateAUser = asyncHandler(async (req, res) => {
  const { id } = req.user;
  validateMongodbId(id);
  const firstname = req?.body?.firstname;
  const lastname = req?.body?.lastname;
  const email = req?.body?.email;
  const mobile = req?.body?.mobile;
  const address = req?.body?.address;
  const image = req?.body?.image;
  const nickname = req?.body?.nickname;

  if (!Validate.string(firstname)) {
    ThrowError("Invalid Firstname");
  }

  if (!Validate.string(lastname)) {
    ThrowError("Invalid Lastname");
  }

  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  if (!Validate.string(mobile)) {
    ThrowError("Invalid Mobile Number");
  }

  if (!Validate.string(address)) {
    ThrowError("Invalid Address");
  }

  if (!Validate.string(nickname)) {
    ThrowError("Invalid Nickname");
  }

  if (image !== undefined && !Validate.cloudinaryUrl(image)) {
    return res.status(400).json({
      success: false,
      message:
        "image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: profiles).",
    });
  }

  try {
    const mobileUser = await User.findOne({ mobile, _id: { $ne: id } }, { _id: 1 });
    if (mobileUser) {
      return res.status(400).json({
        msg: "Mobile number already exists",
        success: false,
      });
    }
    const updatedUser = await User.findByIdAndUpdate(
      id,
      {
        firstname,
        lastname,
        email,
        mobile,
        address,
        nickname,
        ...(image !== undefined && { image }),
      },
      { new: true },
    );
    audit.log({
      action: "user.updated",
      actor: audit.actor(req),
      resource: { type: "user", id, displayName: updatedUser?.email },
      changes: { after: { firstname, lastname, email, mobile, nickname } },
    });
    res.json(updatedUser);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = updateAUser;
