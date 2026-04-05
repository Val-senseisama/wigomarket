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
 * @function deleteAUser
 * @description Deletes a user by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - User ID to delete (required)
 * @returns {Object} - Deleted user information
 * @throws {Error} - Throws error if invalid MongoDB ID or database operation fails
 */
const deleteAUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  try {
    const deleteUser = await User.findByIdAndDelete(id);
    audit.log({
      action: "user.deleted",
      actor: audit.actor(req),
      resource: { type: "user", id, displayName: deleteUser?.email },
      changes: { before: { email: deleteUser?.email, role: deleteUser?.role } },
    });
    res.json(deleteUser);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = deleteAUser;
