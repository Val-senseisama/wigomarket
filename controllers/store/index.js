const createStore = require('./createStore');
const getAStore = require('./getAStore');
const getAllStores = require('./getAllStores');
const search = require('./search');
const getMyStore = require('./getMyStore');
const updateBankDetails = require('./updateBankDetails');
const updateOrderStatus = require('./updateOrderStatus');
const getPopularSellers = require('./getPopularSellers');
const getNearbySellers = require('./getNearbySellers');
const getSellerStats = require('./getSellerStats');

module.exports = {
  createStore,
  getAStore,
  getAllStores,
  search,
  getMyStore,
  updateBankDetails,
  updateOrderStatus,
  getPopularSellers,
  getNearbySellers,
  getSellerStats
};
