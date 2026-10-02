const createStore = require('./createStore');
const getAStore = require('./getAStore');
const getAllStores = require('./getAllStores');
const getMyStore = require('./getMyStore');
const updateBankDetails = require('./updateBankDetails');
const updateOrderStatus = require('./updateOrderStatus');
const getPopularSellers = require('./getPopularSellers');
const getNearbySellers = require('./getNearbySellers');
const getSellerStats = require('./getSellerStats');
const getStoreOrders = require('./getStoreOrders');
const getStoreOrderDetail = require('./getStoreOrderDetail');
const contactCustomer = require('./contactCustomer');
const getBusinessAnalytics = require('./getBusinessAnalytics');
const getStoreEarnings = require('./getStoreEarnings');
const getRecentEarnings = require('./getRecentEarnings');
const getRecentOrders = require('./getRecentOrders');

module.exports = {
  createStore,
  getAStore,
  getAllStores,
  getMyStore,
  updateBankDetails,
  updateOrderStatus,
  getPopularSellers,
  getNearbySellers,
  getSellerStats,
  getStoreOrders,
  getStoreOrderDetail,
  contactCustomer,
  getBusinessAnalytics,
  getStoreEarnings,
  getRecentEarnings,
  getRecentOrders
};
