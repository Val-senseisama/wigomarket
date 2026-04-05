const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const uniqid = require("uniqid");
const Order = require("../../models/orderModel");
const Cart = require("../../models/cartModel");
const Product = require("../../models/productModel");
const Store = require("../../models/storeModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const appConfig = require("../../config/appConfig");
const deliveryFeeService = require("../../services/deliveryFeeService");

/**
 * @function getOrders
 * @description Retrieves user's order history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getOrders = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  validateMongodbId(_id);

  try {
    const userOrders = await Order.find({ orderedBy: _id })
      .populate({
        path: "products.product",
        select: "store title listedPrice images",
        model: "Product",
        populate: {
          path: "store",
          select: "name address mobile",
          model: "Store",
        },
      })
      .sort({ createdAt: -1 })
      .exec();

    res.json(userOrders);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getOrders;
