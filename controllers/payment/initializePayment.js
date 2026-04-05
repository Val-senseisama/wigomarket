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
const { getFlutterwaveInstance } = require("../../config/flutterwaveClient");
const receiptService = require("../../services/receiptService");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError, MakeID } = require("../../Helpers/Helpers");
const appConfig = require("../../config/appConfig");
const { PaymentStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");
const { calculateCommissionBreakdown } = require("../../services/commissionService");

/**
 * @function initializePayment
 * @description Initialize payment with Flutterwave
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.orderId - Order ID to pay for
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Payment initialization response
 */
const initializePayment = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  const { _id } = req.user;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  validateMongodbId(orderId);

  try {
    // Check if user has a wallet (create if doesn't exist)
    let userWallet = await Wallet.findOne({ user: _id });
    if (!userWallet) {
      console.log(`Creating wallet for user ${_id}`);
      userWallet = await Wallet.createWallet(_id, 0);
    }
    // Get order details
    const order = await Order.findById(orderId)
      .populate("orderedBy", "fullName email mobile")
      .populate("products.product", "title listedPrice")
      .populate("products.store", "name");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Check if order belongs to user
    if (order.orderedBy._id.toString() !== _id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This order doesn't belong to you.",
      });
    }

    // Check if order is already paid
    if (order.paymentStatus === PaymentStatus.PAID) {
      return res.status(400).json({
        success: false,
        message: "Order is already paid",
      });
    }

    const user = order.orderedBy;
    const totalAmount = order.paymentIntent.amount;

    // Prepare payment data
    const paymentData = {
      tx_ref: order.paymentIntent.id,
      amount: totalAmount,
      currency: "NGN",
      redirect_url: `${process.env.FRONTEND_URL}/payment/callback`,
      customer: {
        email: user.email,
        phonenumber: user.mobile,
        name: user.fullName || "Customer",
      },
      customizations: {
        title: "WigoMarket Payment",
        description: `Payment for Order #${order.paymentIntent.id}`,
        logo: process.env.LOGO_URL || "https://via.placeholder.com/150",
      },
      meta: {
        orderId: orderId,
        userId: _id,
      },
    };

    // Initialize payment with Flutterwave
    const flwClient = getFlutterwaveInstance();
    const response = await flwClient.Payment.initialize(paymentData);

    if (response.status === "success") {
      // Update order with payment reference
      await Order.findByIdAndUpdate(orderId, {
        "paymentIntent.flw_ref": response.data.flw_ref,
        "paymentIntent.status": PaymentStatus.PENDING,
      });

      audit.log({
        action: "payment.initialized",
        actor: audit.actor(req),
        resource: { type: "order", id: orderId },
        changes: { after: { amount: totalAmount, flw_ref: response.data.flw_ref, paymentStatus: "Pending" } },
      });

      res.json({
        success: true,
        message: "Payment initialized successfully",
        data: {
          payment_url: response.data.link,
          flw_ref: response.data.flw_ref,
          orderId: orderId,
          amount: totalAmount,
        },
      });
    } else {
      throw new Error(response.message || "Payment initialization failed");
    }
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Payment initialization failed");
  }

});

module.exports = initializePayment;
