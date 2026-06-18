const createDispatchProfile = require('./createDispatchProfile');
const updateDispatchProfile = require('./updateDispatchProfile');
const getDispatchProfile = require('./getDispatchProfile');
const getEarnings = require('./getEarnings');
const getDashboardStats = require('./getDashboardStats');
const updateAvailability = require('./updateAvailability');
const takeDispatch = require('./takeDispatch');
const getDispatchOrders = require('./getDispatchOrders');

const getEarningsHistory = require('./getEarningsHistory');
const getEarningsOverview = require('./getEarningsOverview');
const updateRiderAccount = require('./updateRiderAccount');
const deleteRiderAccount = require('./deleteRiderAccount');

module.exports = {
  createDispatchProfile,
  updateDispatchProfile,
  getDispatchProfile,
  getEarnings,
  getEarningsHistory,
  getEarningsOverview,
  getDashboardStats,
  updateAvailability,
  takeDispatch,
  getDispatchOrders,
  updateRiderAccount,
  deleteRiderAccount,
};
