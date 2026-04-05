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
      { status: { $ne: "pending" } }, // Filter for users whose status is not 'pending'
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

module.exports = getAllUsers;
