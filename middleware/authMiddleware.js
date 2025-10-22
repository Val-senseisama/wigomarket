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
        const user = await User.findById(decoded?.id).select('-password -refreshToken');
        
        if (!user) {
          throw new Error("User not found");
        }
        
        if (user.isBlocked) {
          throw new Error("User account is blocked");
        }
        
        if (user.status !== 'active') {
          throw new Error("User account is not active");
        }
        
        // Add user info to request
        req.user = user;
        req.userId = user._id;
        req.userRoles = user.role;
        req.activeRole = user.activeRole;
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
  const userRoles = req.userRoles;

  if (!userRoles || !userRoles.includes("seller")) {
    throw new Error("You are not a seller");
  }

  // Assign store ID if needed
  const store = await Store.findOne({ owner: req.userId }, "_id");
  req.store = store ? store._id : null;
  next();
});

const isDispatch = asyncHandler(async (req, res, next) => {
  const userRoles = req.userRoles;

  if (!userRoles || !userRoles.includes("dispatch")) {
    throw new Error("You are not a dispatch user");
  }

  next();
});

const isAdmin = asyncHandler(async (req, res, next) => {
  const userRoles = req.userRoles;

  if (!userRoles || !userRoles.includes("admin")) {
    throw new Error("You are not an admin");
  }

  next();
});
module.exports = { authMiddleware, isAdmin, isDispatch, isSeller };
