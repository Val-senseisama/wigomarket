const getOverview = require("./getOverview");

// Users
const listUsers = require("./listUsers");
const getUserDetail = require("./getUserDetail");
const updateUserRoles = require("./updateUserRoles");
const setUserStatus = require("./setUserStatus");

// Dispatch profiles
const listDispatchProfiles = require("./listDispatchProfiles");
const approveDispatchProfile = require("./approveDispatchProfile");
const rejectDispatchProfile = require("./rejectDispatchProfile");
const suspendDispatchProfile = require("./suspendDispatchProfile");
const verifyDispatchDocument = require("./verifyDispatchDocument");

// Stores
const listStores = require("./listStores");
const setStoreStatus = require("./setStoreStatus");

// Wallets
const listWallets = require("./listWallets");
const setWalletStatus = require("./setWalletStatus");
const updateWalletLimits = require("./updateWalletLimits");

module.exports = {
  getOverview,
  listUsers,
  getUserDetail,
  updateUserRoles,
  setUserStatus,
  listDispatchProfiles,
  approveDispatchProfile,
  rejectDispatchProfile,
  suspendDispatchProfile,
  verifyDispatchDocument,
  listStores,
  setStoreStatus,
  listWallets,
  setWalletStatus,
  updateWalletLimits,
};
