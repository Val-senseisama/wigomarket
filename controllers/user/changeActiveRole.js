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
        message: "Role is required",
      });
    }

    // Validate role
    const validRoles = ["seller", "buyer", "dispatch", "admin"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be one of: " + validRoles.join(", "),
      });
    }

    // Check if user has this role
    if (!user.role.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "You don't have permission to switch to this role",
      });
    }

    // Update active role
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { activeRole: role },
      { new: true },
    ).select(
      "-password -refreshToken -passwordResetToken -passwordResetExpires",
    );

    audit.log({
      action: "user.role_changed",
      actor: audit.actor(req),
      resource: { type: "user", id: user._id, displayName: user.email },
      changes: { before: { activeRole: user.activeRole }, after: { activeRole: role } },
    });

    res.json({
      success: true,
      message: "Active role updated successfully",
      data: {
        user: updatedUser,
        activeRole: updatedUser.activeRole,
        roles: updatedUser.role,
      },
    });
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = changeActiveRole;
