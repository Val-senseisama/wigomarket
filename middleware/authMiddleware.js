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

const isAdmin = asyncHandler(async (req, res, next) => {
  const { email } = req.user;
  const adminUser = await User.findOne({ email });

  if (adminUser.role !== "admin") {
    throw new Error("You are not an admin");
  } else {
    next();
  }
});

const isSeller = asyncHandler(async (req, res, next) => {
  const { email } = req.user;
  const sellerUser = await User.findOne({ email });

  if (sellerUser.role !== "seller") {
    throw new Error("You are not a seller");
  } else {
    const store = await Store.findOne({ owner: sellerUser.id });
    req.store = store._id;
    next();
  }
});

const isdispatch = asyncHandler(async (req, res, next) => {
  const { email } = req.user;
  const dispatchUser = await User.findOne({ email });

  if (dispatchUser.role !== "dispatch") {
    throw new Error("You are not an dispatch");
  } else {
    req.dispatch = user;
    next();
  }
});

module.exports = { authMiddleware, isAdmin, isdispatch, isSeller };
