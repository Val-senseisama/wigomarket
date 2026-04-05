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
 * @function getOrderById
 * @description Retrieve a single order by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getOrderById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  try {
    const order = await Order.findById(id)
      .populate("products.product")
      .populate("orderedBy", "fullName email mobile")
      .populate("deliveryAgent");

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }
    res.json(order);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getOrderById;
