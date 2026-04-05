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
 * @function generateTransactionStatement
 * @description Generate PDF statement for user transactions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.query.startDate - Start date for statement
 * @param {string} req.query.endDate - End date for statement
 * @returns {Object} - PDF statement file
 */
const generateTransactionStatement = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { startDate, endDate } = req.query;

  try {
    // Get user data
    const user = await User.findById(_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Build query for transactions
    const query = { "entries.userId": _id };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Get transactions
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(1000); // Limit to prevent large PDFs

    if (transactions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No transactions found for the specified period",
      });
    }

    // Generate PDF statement
    const pdfPath = await receiptService.generateTransactionStatement(
      user,
      transactions,
      {
        startDate,
        endDate,
      },
    );

    // Send PDF file
    const filename = `statement_${user._id}_${Date.now()}.pdf`;
    res.download(pdfPath, filename, (err) => {
      if (err) {
        console.error("Error sending PDF:", err);
        res.status(500).json({
          success: false,
          message: "Failed to download statement",
        });
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to generate statement");
  }

});

module.exports = generateTransactionStatement;
