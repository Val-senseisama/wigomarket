const User = require("../models/userModel");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Store = require("../models/storeModel");

/**
 * Every failure path here sets an explicit status before throwing. The global
 * errorHandler falls back to 500 whenever res.statusCode is still 200, so a
 * bare `throw` would report an auth failure as a server error.
 */
const authMiddleware = asyncHandler(async (req, res, next) => {
  if (!req?.headers?.authorization?.startsWith("Bearer")) {
    res.status(401);
    throw new Error(`There is no token attached to the header`);
  }

  // A header of exactly "Bearer" (no value) yields undefined here. This used to
  // fall through without calling next() or throwing, leaving the request hanging
  // until the client timed out.
  const token = req.headers.authorization.split(" ")[1];

  if (!token) {
    res.status(401);
    throw new Error(`There is no token attached to the header`);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    // Scoped to jwt.verify alone. This catch previously wrapped the account
    // checks below too, so a blocked or deactivated user was told their token
    // had expired and would loop through login forever.
    res.status(401);
    throw new Error(`Not Authorised token expired please login again`);
  }

  const user = await User.findById(decoded?.id).select("-password -refreshToken");

  if (!user) {
    res.status(401);
    throw new Error("User not found");
  }

  // The token is valid but the account may not be usable. 403 rather than 401:
  // re-authenticating will not help, so the client must not bounce to login.
  if (user.isBlocked) {
    res.status(403);
    throw new Error("User account is blocked");
  }

  if (user.status !== "active") {
    res.status(403);
    throw new Error("User account is not active");
  }

  // Add user info to request
  req.user = user;
  req.userId = user._id;
  req.userRoles = user.role;
  req.activeRole = user.activeRole;
  next();
});

const isSeller = asyncHandler(async (req, res, next) => {
  const userRoles = req.userRoles;

  if (!userRoles || !userRoles.includes("seller")) {
    res.status(403);
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
    res.status(403);
    throw new Error("You are not a dispatch user");
  }

  next();
});

const isAdmin = asyncHandler(async (req, res, next) => {
  const userRoles = req.userRoles;

  if (!userRoles || !userRoles.includes("admin")) {
    res.status(403);
    throw new Error("You are not an admin");
  }

  // Admin actions require the user to have explicitly switched into their admin
  // role (PUT /api/user/change-role with { role: "admin" }). This keeps admin
  // operations off the default session of multi-role accounts.
  if (req.activeRole !== "admin") {
    res.status(403);
    throw new Error("Switch to your admin role to access this resource");
  }

  next();
});
module.exports = { authMiddleware, isAdmin, isDispatch, isSeller };
