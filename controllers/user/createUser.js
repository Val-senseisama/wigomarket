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
const createBuyer = require("./createBuyer");

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

module.exports = createUser;
