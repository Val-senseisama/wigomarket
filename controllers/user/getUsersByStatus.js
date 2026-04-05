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
  const possibleStatusValues = ["active", "pending", "blocked"];
  if (!possibleStatusValues.includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }
  try {
    const getUsers = await User.find(
      { status: status }, // Filter for users with the specified status
      {
        _id: 1,
        image: 1,
        firstname: 1,
        lastname: 1,
        role: 1,
        mobile: 1,
        nickname: 1,
      }, // Specify the fields to return
    );
    res.json(getUsers);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getUsersByStatus;
