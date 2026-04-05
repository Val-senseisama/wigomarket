const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const crypto = require("crypto");
const Order = require("../../models/orderModel");
const Store = require("../../models/storeModel");
const Product = require("../../models/productModel");
const User = require("../../models/userModel");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");
const VATConfig = require("../../models/vatConfigModel");
const Flutterwave = require("flutterwave-node-v3");
const receiptService = require("../../services/receiptService");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError, MakeID } = require("../../Helpers/Helpers");
const appConfig = require("../../config/appConfig");

/**
 * @function getPaymentStatus
 * @description Get payment status for an order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.orderId - Order ID
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Payment status information
 */
const getPaymentStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { _id } = req.user;

  validateMongodbId(orderId);

  try {
    const order = await Order.findOne({
      _id: orderId,
      orderedBy: _id,
    }).select("paymentIntent paymentStatus orderStatus");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: {
        orderId: orderId,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        paymentIntent: order.paymentIntent,
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get payment status");
  }

});

module.exports = getPaymentStatus;
