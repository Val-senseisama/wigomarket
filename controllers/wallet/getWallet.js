const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");
const VATConfig = require("../../models/vatConfigModel");
const User = require("../../models/userModel");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError, MakeID } = require("../../Helpers/Helpers");

/**
 * @function getWallet
 * @description Get user's wallet information
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Wallet information
 */
const getWallet = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  
  try {
    const wallet = await Wallet.getWalletByUser(_id);
    
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }
    
    res.json({
      success: true,
      data: wallet
    });
  } catch (error) {
    throw new Error(error.message);
  }

});

module.exports = getWallet;
