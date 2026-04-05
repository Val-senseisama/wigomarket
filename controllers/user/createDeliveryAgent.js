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
const { welcome, verificationCodeTemplate } = require("../../templates/Emails");
const audit = require("../../services/auditService");

/**
 * @function createDeliveryAgent
 * @description Creates a new delivery agent account with email verification
 * @param {Object} req - Express request object containing user data
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.mobile - User's mobile number (required)
 * @param {string} req.body.password - User's password (required)
 * @param {string} req.body.fullName - User's full name (optional)
 * @param {string} req.body.residentialAddress - User's residential address (optional)
 * @param {string} req.body.city - User's city (optional)
 * @param {string} req.body.gender - User's gender (optional)
 * @param {string} req.body.state - User's state (optional)
 * @param {Object} req.body.nextOfKin - Next of kin information (required for delivery agents)
 * @param {string} req.body.modeOfTransport - Mode of transport (required for delivery agents)
 * @returns {Object} - New user data or error message
 * @throws {Error} - Throws error if validation fails or user already exists
 */
const createDeliveryAgent = asyncHandler(async (req, res) => {
  console.log(req.body);
  const email = req.body.email;
  let number = req.body.mobile;
  const password = req.body.password;
  const fullName = req.body.fullName;
  const residentialAddress = req.body.residentialAddress;
  const city = req.body.city;
  const state = req.body.state;
  const nextOfKin = req.body.nextOfKin;
  const gender = req.body.gender;
  const modeOfTransport = req.body.modeOfTransport;
  try {
    // Validate required fields
    if (!Validate.email(email)) {
      ThrowError("Invalid Email");
    }

    if (!Validate.string(number)) {
      ThrowError("Invalid Mobile Number");
    }

    if (!Validate.string(password)) {
      ThrowError("Invalid Password");
    }

    // Validate delivery agent specific fields
    if (!nextOfKin || !nextOfKin.name || !nextOfKin.mobile) {
      ThrowError("Next of kin information is required for delivery agents");
    }

    if (!modeOfTransport) {
      ThrowError("Mode of transport is required for delivery agents");
    }
    const validGenders = ["male", "female", "other"];
    if (!gender || !validGenders.includes(gender)) {
      ThrowError("Gender is required for delivery agents");
    }

    const validTransportModes = [
      "bike",
      "motorcycle",
      "car",
      "van",
      "truck",
      "bicycle",
      "feet",
      "bus",
    ];
    if (!validTransportModes.includes(modeOfTransport)) {
      ThrowError(
        "Invalid mode of transport. Must be one of: " +
          validTransportModes.join(", "),
      );
    }

    number = Validate.formatPhone(number);
    const findUser = await User.findOne({ email: email }, { fullName: 1 });
    const mobileUser = await User.findOne({ mobile: number }, { fullName: 1 });
    const welcomeMessage = welcome();

    if (!findUser && !mobileUser) {
      const newUser = {
        email,
        mobile: number,
        password,
        fullName: fullName || "",
        residentialAddress: residentialAddress || "",
        city: city || "",
        state: state || "",
        role: ["dispatch"], // Delivery agent role
        activeRole: "dispatch",
        gender: gender,
        nextOfKin: {
          name: nextOfKin.name,
          mobile: nextOfKin.mobile,
        },
        modeOfTransport: modeOfTransport,
      };

      const code = MakeID(6);
      const token = {
        email,
        code,
      };

      // Create new user
      const createUser = await User.create(newUser);
      const createCode = await Token.create(token);

      const data1 = {
        to: email,
        text: `Welcome to WigoMarket!`,
        subject: "Welcome to WigoMarket - Start Delivering!",
        htm: welcomeMessage,
      };

      const data2 = {
        to: email,
        text: ``,
        subject: "Account Verification - WigoMarket",
        htm: verificationCodeTemplate(fullName || "User", code),
      };

      sendEmail(data1, true);
      sendEmail(data2, true);

      audit.log({
        action: "user.created",
        actor: { email, ip: req.ip },
        resource: { type: "user", id: createUser._id },
        metadata: { role: newUser.role },
      });

      res.json({
        success: true,
        message:
          "Delivery agent account created successfully. Please check your email for verification code.",
        data: {
          user: {
            _id: createUser._id,
            email: createUser.email,
            mobile: createUser.mobile,
            fullName: createUser.fullName,
            role: createUser.role,
            gender: createUser.gender,
            status: createUser.status,
            nextOfKin: createUser.nextOfKin,
            modeOfTransport: createUser.modeOfTransport,
          },
          verificationCode: code, // For testing purposes
        },
      });
    } else {
      ThrowError("User Already Exists");
    }
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

module.exports = createDeliveryAgent;
