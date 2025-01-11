const User = require("../models/userModel");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Store = require("../models/storeModel");

const authMiddleware = asyncHandler(async (req, res, next) => {
  let token;
  if (req?.headers?.authorization?.startsWith("Bearer")) {
    token = req.headers.authorization.split(" ")[1];
    try {
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded?.id);
        req.user = user;
        next();
      }
    } catch (error) {
      throw new Error(`Not Authorised token expired please login again`);
    }
  } else {
    throw new Error(`There is no token attached to the header`);
  }
});

const isSeller = asyncHandler(async (req, res, next) => {
  const { email } = req.user;

  // Fetch the user with the required fields
  const sellerUser = await User.findOne({ email }).select('role');

  if (!sellerUser || !sellerUser.role.includes("seller")) {
    throw new Error("You are not a seller");
  }

  // Assign store ID if needed
  const store = await Store.findOne({ owner: sellerUser._id }, "_id");
  req.store = store ? store._id : null;
  next();
});

const isdispatch = asyncHandler(async (req, res, next) => {
  const { email } = req.user;

  // Fetch the user with the required fields
  const dispatchUser = await User.findOne({ email }).select('role');

  if (!dispatchUser || !dispatchUser.role.includes("dispatch")) {
    throw new Error("You are not a dispatch user");
  }

  next();
});

const isAdmin = asyncHandler(async (req, res, next) => {
  const { email } = req.user;

  // Fetch the user with the required fields
  const adminUser = await User.findOne({ email }).select('role');

  if (!adminUser || adminUser.role !== "admin") {
    throw new Error("You are not an admin");
  }

  next();
});
module.exports = { authMiddleware, isAdmin, isdispatch, isSeller };
