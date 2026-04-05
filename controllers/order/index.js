const createOrder = require('./createOrder');
const getOrders = require('./getOrders');
const getOrderById = require('./getOrderById');
const updateOrderStatus = require('./updateOrderStatus');
const confirmDelivery = require('./confirmDelivery');

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  confirmDelivery,
};
