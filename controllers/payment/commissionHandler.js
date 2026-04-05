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
const { calculateCommissionBreakdown } = require("../../services/commissionService");

/**
 * @function commissionHandler
 * @description Calculate commissions for stores and platform with wallet integration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Commission breakdown
 */
const commissionHandler = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  try {
    const order = await Order.findOne({ orderedBy: _id })
      .populate({
        path: "products.product",
        select: "store price listedPrice",
        model: "Product",
        populate: {
          path: "store",
          select: "bankDetails name",
          model: "Store",
        },
      })
      .populate("deliveryAgent", "fullName email mobile");

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "No order found for this user",
      });
    }

    // Calculate commission breakdown
    const commissionData = await calculateCommissionBreakdown(order);

    // Get VAT configuration
    const vatConfig = await VATConfig.getActiveConfig();
    const vatAmount = vatConfig
      ? vatConfig.calculateVAT(order.paymentIntent.amount)
      : 0;

    // Determine VAT responsibility
    const vendor = await User.findById(order.products[0].product.store);
    const vatResponsibility = vatConfig
      ? vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount)
      : "platform";

    // Group commissions by store
    const storeCommissions = {};

    order.products.forEach((item) => {
      const storeId = item.product.store._id.toString();
      const storePrice = item.product.price;
      const listedPrice = item.product.listedPrice;
      const count = item.count;

      const storeCommission = storePrice * count;
      const platformCommission = listedPrice * count - storeCommission;

      if (!storeCommissions[storeId]) {
        storeCommissions[storeId] = {
          store: item.product.store,
          storeCommission: 0,
          platformCommission: 0,
          totalAmount: 0,
        };
      }

      storeCommissions[storeId].storeCommission += storeCommission;
      storeCommissions[storeId].platformCommission += platformCommission;
      storeCommissions[storeId].totalAmount += listedPrice * count;
    });

    const payblocks = Object.values(storeCommissions).map((item) => ({
      store: item.store,
      storeCommission: Math.round(item.storeCommission * 100) / 100,
      platformCommission: Math.round(item.platformCommission * 100) / 100,
      totalAmount: Math.round(item.totalAmount * 100) / 100,
    }));

    res.json({
      success: true,
      data: {
        orderId: order._id,
        totalAmount: order.paymentIntent.amount,
        commissionBreakdown: commissionData,
        vat: {
          amount: vatAmount,
          responsibility: vatResponsibility,
          rate: vatConfig ? vatConfig.rates.standard : 7.5,
        },
        storeCommissions: payblocks,
        dispatch: order.deliveryAgent
          ? {
              agent: order.deliveryAgent,
              fee: order.deliveryFee || 0,
            }
          : null,
      },
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to calculate commissions");
  }

});

module.exports = commissionHandler;
