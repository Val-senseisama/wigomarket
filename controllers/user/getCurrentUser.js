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
        message: "User not found",
      });
    }

    // Populate related data based on user roles
    let populatedUser = { ...user.toObject() };

    // If user is a seller, populate store information
    if (user.role.includes("seller")) {
      const store = await Store.findOne({ owner: user._id }).select(
        "name image address balance status",
      );
      populatedUser.store = store;
    }

    // If user is dispatch, populate dispatch profile
    if (user.role.includes("dispatch")) {
      const DispatchProfile = require("../../models/dispatchProfileModel");
      const dispatchProfile = await DispatchProfile.findOne({
        user: user._id,
      }).select("vehicleInfo availability rating earnings status isActive");
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
          isBuyer: user.role.includes("buyer"),
        },
      },
    });
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getCurrentUser;
