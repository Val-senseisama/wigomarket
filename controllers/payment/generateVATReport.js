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
 * @function generateVATReport
 * @description Generate PDF VAT report (Admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.query.startDate - Start date for report
 * @param {string} req.query.endDate - End date for report
 * @returns {Object} - PDF VAT report file
 */
const generateVATReport = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  try {
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    // Get VAT summary
    const vatSummary = await Transaction.getVATSummary(start, end);

    if (!vatSummary || vatSummary.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No VAT data found for the specified period",
      });
    }

    // Process VAT summary data
    const processedSummary = {
      totalVATCollected: vatSummary.reduce(
        (sum, item) => sum + item.totalVATCollected,
        0,
      ),
      totalTransactions: vatSummary.reduce(
        (sum, item) => sum + item.totalTransactions,
        0,
      ),
      platformVAT:
        vatSummary.find((item) => item._id === "platform")?.totalVATCollected ||
        0,
      vendorVAT:
        vatSummary.find((item) => item._id === "vendor")?.totalVATCollected ||
        0,
      breakdown: vatSummary,
    };

    // Generate PDF report
    const pdfPath = await receiptService.generateVATReport(processedSummary, {
      startDate: start,
      endDate: end,
    });

    // Send PDF file
    const filename = `vat_report_${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}.pdf`;
    res.download(pdfPath, filename, (err) => {
      if (err) {
        console.error("Error sending PDF:", err);
        res.status(500).json({
          success: false,
          message: "Failed to download VAT report",
        });
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to generate VAT report");
  }

});

module.exports = generateVATReport;
