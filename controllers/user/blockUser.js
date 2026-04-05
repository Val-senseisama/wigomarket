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
 * @function blockUser
 * @description Blocks a user by setting their isBlocked status to true
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - User ID to block (required)
 * @returns {Object} - Updated user information with blocked status
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const blockUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  try {
    const block = await User.findByIdAndUpdate(
      id,
      {
        isBlocked: true,
      },
      {
        new: true,
      },
    );
    audit.log({
      action: "user.blocked",
      actor: audit.actor(req),
      resource: { type: "user", id, displayName: block?.email },
      changes: { before: { isBlocked: false }, after: { isBlocked: true } },
    });
    res.json(block);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = blockUser;
