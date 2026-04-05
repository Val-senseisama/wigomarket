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
 * @function createBuyer
 * @description Creates a new buyer account with email verification
 * @param {Object} req - Express request object containing user data
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.mobile - User's mobile number (required)
 * @param {string} req.body.password - User's password (required)
 * @param {string} req.body.fullName - User's full name (optional)
 * @param {string} req.body.residentialAddress - User's residential address (optional)
 * @param {string} req.body.city - User's city (optional)
 * @param {string} req.body.state - User's state (optional)
 * @returns {Object} - New user data or error message
 * @throws {Error} - Throws error if validation fails or user already exists
 */
const createBuyer = asyncHandler(async (req, res) => {
  console.log(req.body);
  const email = req.body.email;
  let number = req.body.mobile;
  const password = req.body.password;
  const fullName = req.body.fullName;
  const residentialAddress = req.body.residentialAddress;
  const city = req.body.city;
  const state = req.body.state;

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

  number = Validate.formatPhone(number);
  const findUser = await User.findOne({ email: email }, { firstname: 1 });
  const mobileUser = await User.findOne({ mobile: number }, { firstname: 1 });
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
      role: ["buyer"], // Buyer role
      activeRole: "buyer",
    };

    const code = MakeID(6);
    const token = {
      email,
      code,
    };

    try {
      // Create new user
      const createUser = await User.create(newUser);
      const createCode = await Token.create(token);

      const data1 = {
        to: email,
        text: `Welcome to WigoMarket!`,
        subject: "Welcome to WigoMarket - Let's Shop!",
        htm: welcomeMessage,
      };

      const data2 = {
        to: email,
        text: ``,
        subject: "Account Verification - WigoMarket",
        htm: verificationCodeTemplate(fullName || "User", code),
      };

      sendEmail(data1);
      sendEmail(data2);

      audit.log({
        action: "user.created",
        actor: { email, ip: req.ip },
        resource: { type: "user", id: createUser._id },
        metadata: { role: newUser.role },
      });

      res.json({
        message:
          "User created successfully. Please check your email for verification code.",
        success: true,
        user: {
          email: newUser.email,
          mobile: newUser.mobile,
          role: newUser.role,
        },
      });
    } catch (error) {
      throw new Error(error);
    }
  } else {
    return res.status(400).json({
      msg: "User already exists",
      success: false,
    });
  }
});

module.exports = createBuyer;
