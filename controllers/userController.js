const User = require("../models/userModel");
const Token = require("../models/tokensModel");
const asyncHandler = require("express-async-handler");
const { generateToken } = require("../config/jwt");
const validateMongodbId = require("../utils/validateMongodbId");
const { generateRefreshToken } = require("../config/refreshToken");
const jwt = require("jsonwebtoken");
const sendEmail = require("../controllers/emailController");
const crypto = require("crypto");
const Cart = require("../models/cartModel");
const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const uniqid = require("uniqid");
const { Validate } = require("../Helpers/Validate");
const { ThrowError, MakeID } = require("../Helpers/Helpers");
const { verificationCodeTemplate, welcome, forgotPasswordTemplate } = require("../templates/Emails");
// ==================== BUYER SIGNUP ====================
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
 * @param {string} req.body.country - User's country (optional)
 * @param {string} req.body.city - User's city (optional)
 * @param {string} req.body.state - User's state (optional)
 * @returns {Object} - New user data or error message
 * @throws {Error} - Throws error if validation fails or user already exists
 */
const createBuyer = asyncHandler(async (req, res) => {
  const email = req.body.email;
  let number = req.body.mobile;
  const password = req.body.password;
  const fullName = req.body.fullName;
  const residentialAddress = req.body.residentialAddress;
  const country = req.body.country;
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
      country: country || "",
      city: city || "",
      state: state || "",
      role: ["buyer"] // Buyer role
    };
    
    const code = MakeID(6);
    const token = {
      email,
      code
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
      
      res.json({
        message: "User created successfully. Please check your email for verification code.",
        success: true,
        user: {
          email: newUser.email,
          mobile: newUser.mobile,
          role: newUser.role
        }
      });
    } catch (error) {
      throw new Error(error);
    }
    
  } else {
    res.json({
      msg: "User already exists",
      success: false,
    });
    throw new Error("User already exists");
  }
});

/**
 * @function verifyOtp
 * @description Verifies user's email verification code
 * @param {Object} req - Express request object containing email and code
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.code - Verification code (required)
 * @returns {Object} - Verification status message
 * @throws {Error} - Throws error if email or code is invalid
 */
const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }
  if (!Validate.string(code)) {
    ThrowError("Invalid Code");
  }
  const findUser = await User.findOne({ email: email });
  const findToken = await Token.findOne({ email: email });
  if (findToken.code === code) {
    await User.findOneAndUpdate(
      { email: email },
      {
        status: 'active',
      }
    );
    await Token.findOneAndDelete({ email: email });
    res.json({
      msg: "User verified",
      success: true,
    });
  } else {
    res.json({
      msg: "Invalid code",
      success: false,
    });
    throw new Error("Invalid code");
  }
});

// ==================== SELLER SIGNUP ====================
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
 * @param {string} req.body.country - User's country (optional)
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
  const country = req.body.country;
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
      country: country || "",
      city: city || "",
      state: state || "",
      role: ["seller"] // Seller role
    };
    
    const code = MakeID(6);
    const token = {
      email,
      code
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
      
      await sendEmail(data1);
      await sendEmail(data2);
      
      res.json({
        success: true,
        message: "Seller account created successfully. Please check your email for verification code.",
        data: {
          user: {
            _id: createUser._id,
            email: createUser.email,
            mobile: createUser.mobile,
            fullName: createUser.fullName,
            role: createUser.role,
            status: createUser.status
          },
          verificationCode: code // For testing purposes
        }
      });
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  } else {
    ThrowError("User Already Exists");
  }
});

// ==================== DELIVERY AGENT SIGNUP ====================
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
 * @param {string} req.body.country - User's country (optional)
 * @param {string} req.body.city - User's city (optional)
 * @param {string} req.body.state - User's state (optional)
 * @param {Object} req.body.nextOfKin - Next of kin information (required for delivery agents)
 * @param {string} req.body.modeOfTransport - Mode of transport (required for delivery agents)
 * @returns {Object} - New user data or error message
 * @throws {Error} - Throws error if validation fails or user already exists
 */
const createDeliveryAgent = asyncHandler(async (req, res) => {
  const email = req.body.email;
  let number = req.body.mobile;
  const password = req.body.password;
  const fullName = req.body.fullName;
  const residentialAddress = req.body.residentialAddress;
  const country = req.body.country;
  const city = req.body.city;
  const state = req.body.state;
  const nextOfKin = req.body.nextOfKin;
  const modeOfTransport = req.body.modeOfTransport;

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
  if (!nextOfKin || !nextOfKin.name || !nextOfKin.relationship || !nextOfKin.mobile) {
    ThrowError("Next of kin information is required for delivery agents");
  }

  if (!modeOfTransport) {
    ThrowError("Mode of transport is required for delivery agents");
  }

  const validTransportModes = ["bike", "motorcycle", "car", "van", "truck", "bicycle"];
  if (!validTransportModes.includes(modeOfTransport)) {
    ThrowError("Invalid mode of transport. Must be one of: " + validTransportModes.join(", "));
  }

  const validRelationships = ["spouse", "parent", "sibling", "child", "other"];
  if (!validRelationships.includes(nextOfKin.relationship)) {
    ThrowError("Invalid relationship. Must be one of: " + validRelationships.join(", "));
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
      country: country || "",
      city: city || "",
      state: state || "",
      role: ["dispatch"], // Delivery agent role
      nextOfKin: {
        name: nextOfKin.name,
        relationship: nextOfKin.relationship,
        mobile: nextOfKin.mobile,
        email: nextOfKin.email || "",
        address: nextOfKin.address || ""
      },
      modeOfTransport: modeOfTransport
    };
    
    const code = MakeID(6);
    const token = {
      email,
      code
    };
    
    try {
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
      
      await sendEmail(data1);
      await sendEmail(data2);
      
      res.json({
        success: true,
        message: "Delivery agent account created successfully. Please check your email for verification code.",
        data: {
          user: {
            _id: createUser._id,
            email: createUser.email,
            mobile: createUser.mobile,
            fullName: createUser.fullName,
            role: createUser.role,
            status: createUser.status,
            nextOfKin: createUser.nextOfKin,
            modeOfTransport: createUser.modeOfTransport
          },
          verificationCode: code // For testing purposes
        }
      });
    } catch (error) {
      console.log(error);
      throw new Error(error);
    }
  } else {
    ThrowError("User Already Exists");
  }
});

// ==================== LEGACY CREATE USER (for backward compatibility) ====================
/**
 * @function createUser
 * @description Legacy create user function - redirects to createBuyer
 * @deprecated Use createBuyer, createSeller, or createDeliveryAgent instead
 */
const createUser = asyncHandler(async (req, res) => {
  // Redirect to buyer signup for backward compatibility
  req.body.role = "buyer";
  return createBuyer(req, res);
});

// Login User
/**
 * @function loginUser
 * @description Handles user login and token generation
 * @param {Object} req - Express request object containing login credentials
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @param {string} req.body.password - User's password (required)
 * @returns {Object} - User data and authentication tokens
 * @throws {Error} - Throws error if credentials are invalid
 */
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if(!Validate.email(email)){
    ThrowError("Invalid Email");
  }

  if(!Validate.string(password)){
    ThrowError("Invalid Password");
  }


  //   Check if user exists
  const findUser = await User.findOne({ email }, {password: 1, status: 1, role: 1, activeRole: 1, _id: 1});
  console.log("User:", findUser)
  if (findUser && (await findUser.isPasswordMatched(password))) {
    const refreshToken = await generateRefreshToken(findUser?._id);
    const updateUser = await User.findByIdAndUpdate(
      findUser.id,
      { refreshToken: refreshToken },
      { new: true }
    );
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 72 * 60 * 60 * 1000,
    });
    console.log(updateUser)
    res.json({
      _id: findUser?._id,
      status: findUser?.status,
      role: findUser?.role,
      activeRole: findUser?.activeRole,
      token: generateToken(findUser?._id),
    });
  } else {
    throw new Error("Invalid Credentials");
  }
});

// Handle Refresh Token
/**
 * @function handleRefreshToken
 * @description Handles token refresh for authenticated users
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - New access token
 * @throws {Error} - Throws error if refresh token is invalid or missing
 */
const handleRefreshToken = asyncHandler(async (req, res) => {
  const cookie = req.cookies;
  if (!cookie?.refreshToken) throw new Error("No refresh token in cookies");
  const refreshToken = cookie.refreshToken;
  const user = await User.findOne({ refreshToken: refreshToken });
  if (!user) throw new Error("No refresh token present in db or not matched");
  jwt.verify(refreshToken, process.env.JWT_SECRET, (err, decoded) => {
    if (err || user.id !== decoded.id) {
      throw new Error("There is something wrong with the refresh token");
    } else {
      const accessToken = generateToken(user?._id);
      res.json({ accessToken });
    }
  });
});

// Logout User
/**
 * @function logoutUser
 * @description Logs out the user by clearing the refresh token cookie and updating the user's refresh token in the database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 * @throws {Error} - Throws error if refresh token is invalid or missing
 */
const logoutUser = asyncHandler(async (req, res) => {
  const cookie = req.cookies;
  if (!cookie?.refreshToken) throw new Error("No refresh token in cookies");
  const refreshToken = cookie.refreshToken;
  const user = await User.findOne(refreshToken);
  if (!user) {
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: true,
    });
    res.sendStatus(204); // forbidden
  }
  await User.findOneAndUpdate(refreshToken, {
    refreshToken: "",
  });
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
  });
  res.sendStatus(204); // forbidden
});

// Update a User
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
 const firstname = req?.body?.firstname
 const lastname = req?.body?.lastname
 const  email = req?.body?.email
 const  mobile = req?.body?.mobile
 const  address = req?.body?.address
 const  image = req?.body?.image
 const  nickname = req?.body?.nickname
 
 if(!Validate.string(firstname)){
    ThrowError("Invalid Firstname");
  }

  if(!Validate.string(lastname)){
    ThrowError("Invalid Lastname");
  } 

  if(!Validate.email(email)){
    ThrowError("Invalid Email");
  }

  if(!Validate.string(mobile)){
    ThrowError("Invalid Mobile Number");
  }

  if(!Validate.string(address)){  
    ThrowError("Invalid Address");
  }

  if(!Validate.string(nickname)){
    ThrowError("Invalid Nickname");
  }     

  if(!Validate.string(image)){
    ThrowError("Invalid Image");
  }

  try {
    const mobileUser = await User.findOne({ mobile: mobile }, { _id: 1 });
    if (mobileUser) {
      res.json({
        msg: "Mobile number already exists",
        success: false,
      });
      throw new Error("Mobile number already exists");
    }
    const updatedUser = await User.findByIdAndUpdate(
      id,
      {
        firstname: req?.body?.firstname,
        lastname: req?.body?.lastname,
        email: req?.body?.email,
        mobile: req?.body?.mobile,
        address: req?.body?.addresss,
        image: req?.body?.image,
        nickname: req?.body?.nickname,
      },
      { new: true }
    );
    res.json(updatedUser);
  } catch (error) {
    throw new Error(error);
  }
});

// Get All Users
/**
 * @function getAllUsers
 * @description Retrieves all active users (excluding pending users)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Array} - Array of user objects with selected fields
 * @throws {Error} - Throws error if database operation fails
 */
const getAllUsers = asyncHandler(async (req, res) => {
  try {
    const getUsers = await User.find(
        { status: { $ne: 'pending' } }, // Filter for users whose status is not 'pending'
        { _id: 1, image: 1, firstname: 1, lastname: 1, role: 1, mobile: 1, nickname: 1 } // Specify the fields to return
    );
    res.json(getUsers);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function getUsersByStatus
 * @description Retrieves users filtered by status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.status - User status to filter by (required, must be: 'active', 'pending', or 'blocked')
 * @returns {Object} - Array of users matching the status
 * @throws {Error} - Throws error if invalid status value is provided
 */
const getUsersByStatus = asyncHandler(async (req, res) => {
  const { status } = req.body; // Get the status from the request parameters
  const  possibleStatusValues = ["active", "pending", "blocked"];
  if (!possibleStatusValues.includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }
  try {
    const getUsers = await User.find(
        { status: status }, // Filter for users with the specified status
        { _id: 1, image: 1, firstname: 1, lastname: 1, role: 1, mobile: 1, nickname: 1 } // Specify the fields to return
    );
    res.json(getUsers);
  } catch (error) {
    throw new Error(error);
  }
});

// Get a Single User
/**
 * @function getAUser
 * @description Retrieves a specific user by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - User ID to retrieve (required)
 * @returns {Object} - User information
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const getAUser = asyncHandler(async (req, res) => {
  const { id } = req.body;
  validateMongodbId(id);
  try {
    const getUser = await User.findById(id);
    res.json(getUser);
  } catch (error) {
    throw new Error(error);
  }
});

// Delete a  User
/**
 * @function deleteAUser
 * @description Deletes a user by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - User ID to delete (required)
 * @returns {Object} - Deleted user information
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const deleteAUser = asyncHandler(async (req, res) => {
  const { id } = req.body;
  validateMongodbId(id);
  try {
    const deleteUser = await User.findByIdAndDelete(id);
    res.json(deleteUser);
  } catch (error) {
    throw new Error(error);
  }
});

// Block User
/**
 * @function blockUser
 * @description Blocks a user by setting their isBlocked status to true
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - User ID to block (required)
 * @returns {Object} - Updated user information with blocked status
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const blockUser = asyncHandler(async (req, res) => {
  const { id } = req.body;
  validateMongodbId(id);
  try {
    const block = await User.findByIdAndUpdate(
      id,
      {
        isBlocked: true,
      },
      {
        new: true,
      }
    );
    res.json(block);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function unblockUser
 * @description Unblocks a user by setting their isBlocked status to false
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - User ID to unblock (required)
 * @returns {Object} - Updated user information with unblocked status
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
// Unblock User
const unblockUser = asyncHandler(async (req, res) => {
  const { id } = req.body;
  validateMongodbId(id);
  try {
    const unblock = await User.findByIdAndUpdate(
      id,
      {
        isBlocked: false,
      },
      {
        new: true,
      }
    );
    res.json(unblock);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function updatePassword
 * @description Updates user's password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @param {string} req.body.password - New password to set
 * @returns {Object} - Updated user information or original user info if no password provided
 * @throws {Error} - Throws error if invalid MongoDB ID
 */
const updatePassword = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { password } = req.body;
  validateMongodbId(_id);
  const user = await User.findById(_id);
  if (password) {
    user.password = password;
    const updatedPassword = await user.save();
    res.json(updatedPassword);
  } else {
    res.json(user);
  }
});
/**
 * @function forgotPasswordToken
 * @description Generates and sends 6-digit password reset token to user's email
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.email - User's email address (required)
 * @returns {Object} - Success message with token info
 * @throws {Error} - Throws error if user not found or token creation fails
 */
const forgotPasswordToken = asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  const user = await User.findOne({ email }, { fullName: 1, email: 1 });
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found with this email"
    });
  }

  const token = MakeID(6);
  
  try {
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Upsert the token in the database with 15-minute expiry
    const newToken = await Token.findOneAndUpdate(
      { email },
      { code: hashedToken, createdAt: Date.now() },
      { new: true, upsert: true }
    );

    if (!newToken) {
      throw new Error("Token not created");
    }

    const data = {
      to: email,
      text: `Password Reset Code: ${token}`,
      subject: "Password Reset Code - WigoMarket",
      htm: forgotPasswordTemplate(user?.fullName || "User", token),
    };
    
    sendEmail(data);
    
    res.json({
      success: true,
      message: "Password reset code sent to your email. Please check your inbox.",
      token: token, // For development/testing - remove in production
      expiresIn: "15 minutes"
    });
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function resetPassword
 * @description Resets user's password using 6-digit reset token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.password - New password to set (required)
 * @param {string} req.body.token - 6-digit reset token (required)
 * @param {string} req.body.email - User's email address (required)
 * @returns {Object} - Success message
 * @throws {Error} - Throws error if invalid token or user not found
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { password, token, email } = req.body;
  
  // Validate input
  if (!Validate.string(password)) {
    ThrowError("Invalid Password");
  }
  
  if (!Validate.string(token) || token.length !== 6) {
    ThrowError("Invalid Token - Must be 6 digits");
  }
  
  if (!Validate.email(email)) {
    ThrowError("Invalid Email");
  }

  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  
  // Find user and token
  const user = await User.findOne({ email }, { password: 1, _id: 1, fullName: 1 });
  const tokenRecord = await Token.findOne({
    email,
    code: hashedToken,
  });
  
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "User not found"
    });
  }
  
  if (!tokenRecord) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
  
  // Check if token is expired (15 minutes)
  const tokenAge = Date.now() - tokenRecord.createdAt;
  const fifteenMinutes = 15 * 60 * 1000;
  
  if (tokenAge > fifteenMinutes) {
    await Token.deleteOne({ email });
    return res.status(400).json({
      success: false,
      message: "Token has expired. Please request a new one."
    });
  }
  
  try {
    // Update password
  user.password = password;
  await user.save();
    
    // Delete the used token
  await Token.deleteOne({ email });
    
    res.json({
      success: true,
      message: "Password reset successfully. You can now login with your new password."
    });
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function addToCart2
 * @description Adds a product to user's cart
 * @param {Object} req - Express request object containing product data
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body.product - Product details to add to cart
 * @returns {Object} - Updated cart information
 * @throws {Error} - Throws error if cart operation fails
 */
const addToCart2 = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { product } = req.body;
  
  // Validate input
  if (!product._id || !product.count || product.count <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid product data"
    });
  }
  
  // Check if product exists and is in stock
  const productExists = await Product.findById(product._id);
  if (!productExists) {
    return res.status(404).json({
      success: false,
      message: "Product not found"
    });
  }
  
  if (productExists.quantity < product.count) {
    return res.status(400).json({
      success: false,
      message: "Insufficient stock available"
    });
  }
  
  // Find or create cart
  let cart = await Cart.findOne({ owner: _id });
  
  if (!cart) {
    cart = await Cart.create({ 
      owner: _id, 
      products: [], 
      cartTotal: 0 
    });
  }
  
  // Check if product already exists in cart
  const existingProductIndex = cart.products.findIndex(
    item => item.product.toString() === product._id
  );
  
  if (existingProductIndex > -1) {
    // Update existing product quantity
    const newQuantity = cart.products[existingProductIndex].count + product.count;
    
    // Check if new quantity exceeds stock
    if (newQuantity > productExists.quantity) {
      return res.status(400).json({
        success: false,
        message: "Cannot add more items than available in stock"
      });
    }
    
    cart.products[existingProductIndex].count = newQuantity;
    cart.products[existingProductIndex].price = 
      newQuantity * product.listedPrice;
    } else {
    // Add new product
    cart.products.push({
      product: product._id,
      count: product.count,
      price: product.count * product.listedPrice,
      store: product.store._id
    });
  }
  
  // Recalculate total
  cart.cartTotal = cart.products.reduce((total, item) => total + item.price, 0);
  
  await cart.save();
  
  // Populate and return
  const populatedCart = await Cart.findById(cart._id)
    .populate('products.product', 'title listedPrice images description brand')
    .populate('products.store', 'name address mobile');
  
  res.json({
    success: true,
    message: "Product added to cart successfully",
    data: populatedCart
  });
});
/**
 * @function removeFromCart
 * @description Removes a product from user's cart
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @param {string} req.body.productId - Product ID to remove
 * @returns {Object} - Updated cart information
 * @throws {Error} - Throws error if cart update fails
 */
const removeFromCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { productId } = req.body;
  
  // Validate input
  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Product ID is required"
    });
  }
  
  validateMongodbId(_id);
  validateMongodbId(productId);

  try {
    const cart = await Cart.findOne({ owner: _id });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found"
      });
    }
    
    // Check if product exists in cart
    const productIndex = cart.products.findIndex(
      item => item.product.toString() === productId
    );
    
    if (productIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Product not found in cart"
      });
    }
    
    // Remove product from array
    cart.products.splice(productIndex, 1);
    
    // Recalculate total
    cart.cartTotal = cart.products.reduce((total, item) => total + item.price, 0);
    
    await cart.save();
    
    // Populate and return updated cart
    const updatedCart = await Cart.findById(cart._id)
      .populate('products.product', 'title listedPrice images description brand')
      .populate('products.store', 'name address mobile');
    
    res.json({
      success: true,
      message: "Product removed from cart successfully",
      data: updatedCart
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});
/**
 * @function updateCart
 * @description Updates product quantity in user's cart
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user.id - Authenticated user's ID (required)
 * @param {number} req.body.count - Current product count
 * @param {number} req.body.newCount - New product count to set
 * @param {string} req.body._id - Product ID in cart
 * @param {Object} req.body.product - Product details
 * @param {number} req.body.product.listedPrice - Product price
 * @returns {Object} - Updated cart information
 */
const updateCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { productId, newCount } = req.body;
  
  // Validate input
  if (!productId) {
    return res.status(400).json({
      success: false,
      message: "Product ID is required"
    });
  }
  
  if (newCount === undefined || newCount < 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid quantity"
    });
  }
  
  validateMongodbId(_id);
  validateMongodbId(productId);

  try {
    const cart = await Cart.findOne({ owner: _id });
    
    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Cart not found"
      });
    }
    
    // Find product in cart
    const productIndex = cart.products.findIndex(
      item => item.product.toString() === productId
    );
    
    if (productIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Product not found in cart"
      });
    }
    
    // Get product details for price calculation
    const productDetails = await Product.findById(productId);
    if (!productDetails) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }
    
    // Check stock availability
    if (newCount > productDetails.quantity) {
      return res.status(400).json({
        success: false,
        message: "Insufficient stock available"
      });
    }
    
    if (newCount === 0) {
      // Remove product if quantity is 0
      cart.products.splice(productIndex, 1);
    } else {
      // Update quantity and price
      cart.products[productIndex].count = newCount;
      cart.products[productIndex].price = newCount * productDetails.listedPrice;
    }
    
    // Recalculate total
    cart.cartTotal = cart.products.reduce((total, item) => total + item.price, 0);
    
    await cart.save();
    
    // Populate and return updated cart
    const updatedCart = await Cart.findById(cart._id)
      .populate('products.product', 'title listedPrice images description brand')
      .populate('products.store', 'name address mobile');
    
    res.json({
      success: true,
      message: "Cart updated successfully",
      data: updatedCart
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});
/**
 * @function getUserCart
 * @description Retrieves user's cart with populated product details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @returns {Object} - User's cart with populated product details
 * @throws {Error} - Throws error if cart retrieval fails
 */
const getUserCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);
  
  try {
    const cart = await Cart.findOne({ owner: _id })
      .populate('products.product', 'title listedPrice images description brand quantity')
      .populate('products.store', 'name address mobile');
    
    if (!cart) {
      return res.json({
        success: true,
        data: {
          products: [],
          cartTotal: 0,
          owner: _id
        }
      });
    }
    
    // Check if any products are out of stock or have been deleted
    const validProducts = [];
    let totalCost = 0;
    
    for (const item of cart.products) {
      if (item.product && item.product.quantity > 0) {
        // Update price if product price has changed
        const currentPrice = item.product.listedPrice;
        if (item.price !== currentPrice * item.count) {
          item.price = currentPrice * item.count;
        }
        totalCost += item.price;
        validProducts.push(item);
      }
    }
    
    // Update cart if products were removed
    if (validProducts.length !== cart.products.length) {
      cart.products = validProducts;
      cart.cartTotal = totalCost;
      await cart.save();
    }
    
    res.json({
      success: true,
      data: cart
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});
/**
 * @function emptyCart
 * @description Empties user's cart by removing it from the database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @returns {Object} - Success message
 * @throws {Error} - Throws error if cart removal fails
 */
const emptyCart = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);
  
  try {
    const cart = await Cart.findOneAndDelete({ owner: _id });
    
    if (!cart) {
      return res.json({
        success: true,
        message: "Cart is already empty",
        data: {
          products: [],
          cartTotal: 0,
          owner: _id
        }
      });
    }
    
    res.json({
      success: true,
      message: "Cart emptied successfully",
      data: {
        products: [],
        cartTotal: 0,
        owner: _id
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});
/**
 * @function createOrder
 * @description Creates a new order for the user
 * @param {Object} req - Express request object containing order details
 * @param {Object} res - Express response object
 * @param {string} req.body.paymentIntent - Payment intent ID
 * @param {string} req.body.deliveryMethod - Delivery method
 * @param {Object} req.body.deliveryAddress - Delivery address details
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Created order details
 * @throws {Error} - Throws error if order creation fails
 */
const checkoutCart = asyncHandler(async (req, res) => {
  const { paymentMethod, deliveryMethod, deliveryAddress, deliveryNotes } = req.body;
  const { _id } = req.user;
  
  // Validate input
  if (!paymentMethod || !deliveryMethod || !deliveryAddress) {
    return res.status(400).json({
      success: false,
      message: "Payment method, delivery method, and delivery address are required"
    });
  }
  
  if (!["self_delivery", "delivery_agent"].includes(deliveryMethod)) {
    return res.status(400).json({
      success: false,
      message: "Invalid delivery method. Must be 'self_delivery' or 'delivery_agent'"
    });
  }
  
  if (!["cash", "card", "bank"].includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment method. Must be 'cash', 'card', or 'bank'"
    });
  }
  
  validateMongodbId(_id);
  
  try {
    // Get user's cart
    const userCart = await Cart.findOne({ owner: _id }).populate("products.product");
    
    if (!userCart || userCart.products.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Cart is empty"
      });
    }
    
    // Check stock availability
    for (const item of userCart.products) {
      if (item.product.quantity < item.count) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${item.product.title}. Available: ${item.product.quantity}, Requested: ${item.count}`
        });
      }
    }
    
    // Calculate delivery fee (if delivery agent is selected)
    let deliveryFee = 0;
    if (deliveryMethod === "delivery_agent") {
      // Calculate delivery fee based on distance or fixed rate
      deliveryFee = 500; // Base delivery fee in NGN
    }
    
    const totalAmount = userCart.cartTotal + deliveryFee;
    
    // Create order
    const newOrder = await Order.create({
      products: userCart.products,
      paymentIntent: {
        id: uniqid(),
        method: paymentMethod,
        amount: totalAmount,
        status: "unpaid",
        created: Date.now(),
        currency: "NGN",
      },
      deliveryMethod: deliveryMethod,
      deliveryAddress: deliveryAddress,
      deliveryNotes: deliveryNotes || "",
      deliveryFee: deliveryFee,
      deliveryStatus: deliveryMethod === "delivery_agent" ? "pending_assignment" : "assigned",
      orderedBy: _id,
      orderStatus: "Not yet processed",
      paymentStatus: "Not yet paid",
      paymentMethod: paymentMethod,
    });
    
    // Update product quantities and sold counts
    const productUpdates = userCart.products.map((item) => ({
        updateOne: {
        filter: { _id: item.product._id },
          update: {
          $inc: { 
            quantity: -item.count, 
            sold: +item.count 
          } 
        },
      },
    }));
    
    await Product.bulkWrite(productUpdates);
    
    // Clear user's cart
    await Cart.findOneAndDelete({ owner: _id });
    
    // Populate order details
    const populatedOrder = await Order.findById(newOrder._id)
      .populate('products.product', 'title listedPrice images brand')
      .populate('products.store', 'name address mobile')
      .populate('orderedBy', 'fullName email mobile');
    
    // Send notifications
    try {
      const { sendNotificationToUser, sendDeliveryAgentNotification } = require('./notificationController');
      
      // Notify customer
      await sendNotificationToUser(
        _id,
        "Order Created Successfully",
        `Your order #${newOrder.paymentIntent.id} has been created. ${deliveryMethod === "delivery_agent" ? "Waiting for delivery agent assignment." : "Ready for pickup."}`,
        {
          orderId: newOrder._id.toString(),
          orderNumber: newOrder.paymentIntent.id,
          totalAmount: totalAmount.toString(),
          deliveryMethod: deliveryMethod
        },
        'orderUpdates'
      );
      
      // Notify delivery agents if delivery method is delivery_agent
      if (deliveryMethod === "delivery_agent") {
        await sendDeliveryAgentNotification(
          'new_order_available',
          `New delivery order available: Order #${newOrder.paymentIntent.id}`,
          {
            orderId: newOrder._id.toString(),
            orderNumber: newOrder.paymentIntent.id,
            deliveryAddress: deliveryAddress,
            totalAmount: totalAmount.toString()
          }
        );
      }
    } catch (notificationError) {
      console.log('Notification error:', notificationError);
      // Don't fail the order creation if notifications fail
    }
    
    res.json({
      success: true,
      message: "Order created successfully",
      data: {
        order: populatedOrder,
        totalAmount: totalAmount,
        deliveryFee: deliveryFee,
        deliveryMethod: deliveryMethod,
        nextStep: deliveryMethod === "delivery_agent" 
          ? "Waiting for delivery agent assignment" 
          : "Ready for pickup"
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});
/**
 * @function getOrders
 * @description Retrieves user's order history with detailed product and store information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID (required)
 * @returns {Array} - Array of user's orders with populated product and store details
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const getOrders = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongoDbId(_id);
  try {
    const userOrders = await Order.find({ orderedBy: _id })
      .populate({
        path: "products.product",
        select: "store",
        model: "Product",
        populate: {
          path: "store",
          select: "bankDetails, address, owner",
          model: "Store",
          populate: {
            path: "owner",
            select: "mobile, email",
            model: "User",
          },
        },
      })
      .exec();
    res.json(userOrders);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function updateOrderStatus
 * @description Updates the status of a specific order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.status - New order status to set (required)
 * @param {string} req.body.id - Order ID to update (required)
 * @returns {Object} - Updated order information
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.body;
  validateMongoDbId(id);
  try {
    const updatedOrderStatus = await Order.findByIdAndUpdate(
      id,
      {
        orderStatus: status,
        paymentIntent: {
          status: status,
        },
      },
      { new: true }
    );
    res.json(updatedOrderStatus);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getCurrentUser
 * @description Get current authenticated user's information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} req.user - Authenticated user from middleware
 * @returns {Object} - Current user information
 * @throws {Error} - Throws error if user not found
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  try {
    const user = req.user;
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Populate related data based on user roles
    let populatedUser = { ...user.toObject() };
    
    // If user is a seller, populate store information
    if (user.role.includes("seller")) {
      const store = await Store.findOne({ owner: user._id })
        .select('name image address balance status');
      populatedUser.store = store;
    }
    
    // If user is dispatch, populate dispatch profile
    if (user.role.includes("dispatch")) {
      const DispatchProfile = require("../models/dispatchProfileModel");
      const dispatchProfile = await DispatchProfile.findOne({ user: user._id })
        .select('vehicleInfo availability rating earnings status isActive');
      populatedUser.dispatchProfile = dispatchProfile;
    }

    res.json({
      success: true,
      data: {
        user: populatedUser,
        roles: user.role,
        activeRole: user.activeRole,
        permissions: {
          canSell: user.role.includes("seller"),
          canDispatch: user.role.includes("dispatch"),
          isAdmin: user.role.includes("admin"),
          isBuyer: user.role.includes("buyer")
        }
      }
    });
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function changeActiveRole
 * @description Change the user's active role
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} req.user - Authenticated user from middleware
 * @param {string} req.body.role - New active role to set
 * @returns {Object} - Success message with updated user data
 * @throws {Error} - Throws error if role is invalid or user doesn't have that role
 */
const changeActiveRole = asyncHandler(async (req, res) => {
  try {
    const { role } = req.body;
    const user = req.user;
    
    if (!role) {
      return res.status(400).json({
        success: false,
        message: "Role is required"
      });
    }

    // Validate role
    const validRoles = ["seller", "buyer", "dispatch", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be one of: " + validRoles.join(", ")
      });
    }

    // Check if user has this role
    if (!user.role.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "You don't have permission to switch to this role"
      });
    }

    // Update active role
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { activeRole: role },
      { new: true }
    ).select('-password -refreshToken -passwordResetToken -passwordResetExpires');

    res.json({
      success: true,
      message: "Active role updated successfully",
      data: {
        user: updatedUser,
        activeRole: updatedUser.activeRole,
        roles: updatedUser.role
      }
    });
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function googleAuth
 * @description Authenticate user with Google using Firebase ID token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.idToken - Firebase ID token from Google
 * @returns {Object} - User data and authentication tokens
 * @throws {Error} - Throws error if token is invalid
 */
const googleAuth = asyncHandler(async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({
      success: false,
      message: "ID token is required"
    });
  }

  try {
    // Import Firebase Admin SDK
    const admin = require('firebase-admin');
    
    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;

    // Check if user exists in MongoDB by Firebase UID
    let user = await User.findOne({ firebaseUid: uid });
    
    if (!user) {
      // Check if user exists by email (for existing users who might link Google)
      const existingUser = await User.findOne({ email: email });
      
      if (existingUser) {
        // Link Firebase UID to existing user
        existingUser.firebaseUid = uid;
        existingUser.fullName = existingUser.fullName || name;
        existingUser.image = existingUser.image || picture;
        await existingUser.save();
        user = existingUser;
      } else {
        // Create new user with Google authentication
        user = await User.create({
          firebaseUid: uid,
          email: email,
          fullName: name,
          image: picture,
          role: ["buyer"], // Default role for Google auth users
          activeRole: "buyer",
          status: "active", // Auto-activate Google auth users
          password: null // No password for Google auth users
        });
      }
    }

    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "User account is blocked"
      });
    }

    // Generate JWT token
    const token = generateToken(user._id);
    
    // Generate refresh token
    const refreshToken = await generateRefreshToken(user._id);
    
    // Update user's refresh token
    await User.findByIdAndUpdate(
      user._id,
      { refreshToken: refreshToken },
      { new: true }
    );

    // Set refresh token cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      maxAge: 72 * 60 * 60 * 1000, // 3 days
    });

    res.json({
      success: true,
      message: "Google authentication successful",
      data: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        image: user.image,
        role: user.role,
        activeRole: user.activeRole,
        status: user.status,
        token: token,
        isGoogleAuth: true
      }
    });

  } catch (error) {
    console.error('Google auth error:', error);
    
    if (error.code === 'auth/invalid-id-token') {
      return res.status(401).json({
        success: false,
        message: "Invalid Google ID token"
      });
    }
    
    return res.status(500).json({
      success: false,
      message: "Google authentication failed",
      error: error.message
    });
  }
});

module.exports = {
  createUser,
  createBuyer,
  createSeller,
  createDeliveryAgent,
  loginUser,
  getAllUsers,
  getAUser,
  deleteAUser,
  updateAUser,
  blockUser,
  unblockUser,
  handleRefreshToken,
  logoutUser,
  forgotPasswordToken,
  updatePassword,
  resetPassword,
  addToCart2,
  getUserCart,
  emptyCart,
  removeFromCart,
  verifyOtp,
  updateCart,
  checkoutCart,
  updateOrderStatus,
  getUsersByStatus,
  getOrders,
  getCurrentUser,
  changeActiveRole,
  googleAuth,
};
