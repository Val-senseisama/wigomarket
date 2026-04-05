const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");
const VATConfig = require("../../models/vatConfigModel");
const User = require("../../models/userModel");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError, MakeID } = require("../../Helpers/Helpers");

/**
 * @function createWallet
 * @description Create a wallet for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Created wallet information
 */
const createWallet = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  
  try {
    // Check if user already has a wallet
    const existingWallet = await Wallet.findOne({ user: _id });
    if (existingWallet) {
      return res.status(400).json({
        success: false,
        message: "User already has a wallet"
      });
    }
    
    // Create new wallet
    const wallet = await Wallet.createWallet(_id);
    
    res.json({
      success: true,
      message: "Wallet created successfully",
      data: wallet
    });
  } catch (error) {
    throw new Error(error.message);
  }

});

module.exports = createWallet;
