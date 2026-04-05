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
 * @function createSeller
 * @description Creates a new seller account with email verification
 * @param {Object} req - Express request object containing user data
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.mobile - User's mobile number (required)
 * @param {string} req.body.password - User's password (required)
 * @param {string} req.body.fullName - User's full name (optional)
 * @param {string} req.body.residentialAddress - User's residential address (optional)
 * @param {string} req.body.gender - User's gender (optional)
 * @param {string} req.body.city - User's city (optional)
 * @param {string} req.body.state - User's state (optional)
 * @returns {Object} - New user data or error message
 * @throws {Error} - Throws error if validation fails or user already exists
 */
const createSeller = asyncHandler(async (req, res) => {
  const email = req.body.email;
  let number = req.body.mobile;
  const password = req.body.password;
  const fullName = req.body.fullName;
  const residentialAddress = req.body.residentialAddress;
  const city = req.body.city;
  const state = req.body.state;
  const gender = req.body.gender;

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

  if (!Validate.string(gender)) {
    ThrowError("Invalid Gender");
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
      gender: gender,
      role: ["seller"], // Seller role
      activeRole: "seller",
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
        subject: "Welcome to WigoMarket - Start Selling!",
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
          "Seller account created successfully. Please check your email for verification code.",
        data: {
          user: {
            _id: createUser._id,
            email: createUser.email,
            mobile: createUser.mobile,
            fullName: createUser.fullName,
            role: createUser.role,
            status: createUser.status,
            gender: createUser.gender,
          },
          verificationCode: code, // For testing purposes
        },
      });
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  } else {
    ThrowError("User Already Exists");
  }
});

module.exports = createSeller;
