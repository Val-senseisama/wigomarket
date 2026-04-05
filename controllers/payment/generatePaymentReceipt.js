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
const { PaymentStatus } = require("../../utils/constants");
const { calculateCommissionBreakdown } = require("../../services/commissionService");

/**
 * @function generatePaymentReceipt
 * @description Generate PDF receipt for a completed payment
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.orderId - Order ID
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - PDF receipt file
 */
const generatePaymentReceipt = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { _id } = req.user;

  validateMongodbId(orderId);

  try {
    // Get order with populated data
    const order = await Order.findById(orderId)
      .populate("orderedBy", "fullName email mobile")
      .populate("products.product", "title listedPrice price store")
      .populate("products.store", "name")
      .populate("deliveryAgent", "fullName email mobile");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if user has access to this order
    if (order.orderedBy._id.toString() !== _id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This order doesn't belong to you.",
      });
    }

    // Check if order is paid
    if (order.paymentStatus !== PaymentStatus.PAID) {
      return res.status(400).json({
        success: false,
        message: "Receipt can only be generated for paid orders",
      });
    }

    // Get transaction data
    const transaction = await Transaction.findOne({
      reference: `Payment-${orderId}`,
      type: "order_payment",
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Calculate commission breakdown
    const commissionData = await calculateCommissionBreakdown(order);

    // Get VAT configuration
    const vatConfig = await VATConfig.getActiveConfig();
    const vatAmount = vatConfig
      ? vatConfig.calculateVAT(order.paymentIntent.amount)
      : 0;
    const vendor = await User.findById(order.products[0].product.store);
    const vatResponsibility = vatConfig
      ? vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount)
      : "platform";

    const vatData = {
      rate: vatConfig ? vatConfig.rates.standard : 7.5,
      amount: vatAmount,
      responsibility: vatResponsibility,
    };

    // Generate PDF receipt
    const pdfPath = await receiptService.generatePaymentReceipt(
      order,
      transaction,
      commissionData,
      vatData,
    );

    // Send PDF file
    res.download(pdfPath, `receipt_${order.paymentIntent.id}.pdf`, (err) => {
      if (err) {
        console.error("Error sending PDF:", err);
        res.status(500).json({
          success: false,
          message: "Failed to download receipt",
        });
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to generate receipt");
  }

});

module.exports = generatePaymentReceipt;
