const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const VATConfig = require("../models/vatConfigModel");
const User = require("../models/userModel");
const { Validate } = require("../Helpers/Validate");
const { ThrowError, MakeID } = require("../Helpers/Helpers");

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

/**
 * @function updateBankAccount
 * @description Update bank account information for withdrawals
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Bank account details
 * @returns {Object} - Updated wallet information
 */
const updateBankAccount = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { accountName, accountNumber, bankCode, bankName } = req.body;
  
  // Validate required fields
  if (!accountName || !accountNumber || !bankCode || !bankName) {
    return res.status(400).json({
      success: false,
      message: "All bank account fields are required"
    });
  }
  
  try {
    const wallet = await Wallet.findOne({ user: _id });
    
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }
    
    // Update bank account information
    wallet.bankAccount = {
      accountName,
      accountNumber,
      bankCode,
      bankName,
      isVerified: false // Will be verified separately
    };
    
    await wallet.save();
    
    res.json({
      success: true,
      message: "Bank account updated successfully",
      data: wallet
    });
  } catch (error) {
    throw new Error(error.message);
  }
});

/**
 * @function requestWithdrawal
 * @description Request withdrawal from wallet to bank account
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} req.body.amount - Withdrawal amount
 * @returns {Object} - Withdrawal request result
 */
const requestWithdrawal = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { amount } = req.body;
  
  // Validate amount
  if (!amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid withdrawal amount is required"
    });
  }
  
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({ user: _id }).session(session);
      
      if (!wallet) {
        throw new Error("Wallet not found");
      }
      
      if (wallet.status !== 'active') {
        throw new Error("Wallet is not active");
      }
      
      if (!wallet.bankAccount.accountNumber) {
        throw new Error("Bank account not configured");
      }
      
      if (!wallet.canWithdraw) {
        throw new Error("Withdrawal limit exceeded");
      }
      
      if (wallet.balance < amount) {
        throw new Error("Insufficient wallet balance");
      }
      
      // Calculate withdrawal fee (1% or minimum 100 NGN)
      const withdrawalFee = Math.max(amount * 0.01, 100);
      const totalDeduction = amount + withdrawalFee;
      
      if (wallet.balance < totalDeduction) {
        throw new Error("Insufficient balance for withdrawal and fees");
      }
      
      // Deduct funds from wallet
      await wallet.deductFunds(totalDeduction, 'withdrawal');
      
      // Create transaction record
      const transactionId = `WD_${Date.now()}_${MakeID(6)}`;
      const transaction = await Transaction.createTransaction({
        transactionId,
        reference: `Withdrawal-${transactionId}`,
        type: 'wallet_withdrawal',
        totalAmount: amount,
        entries: [
          {
            account: 'accounts_payable',
            userId: _id,
            debit: amount,
            credit: 0,
            description: `Withdrawal to ${wallet.bankAccount.bankName}`
          },
          {
            account: 'wallet_vendor',
            userId: _id,
            debit: 0,
            credit: amount,
            description: 'Wallet withdrawal'
          },
          {
            account: 'bank_transfer_fees',
            userId: _id,
            debit: withdrawalFee,
            credit: 0,
            description: 'Withdrawal processing fee'
          },
          {
            account: 'wallet_vendor',
            userId: _id,
            debit: 0,
            credit: withdrawalFee,
            description: 'Fee deduction'
          }
        ],
        relatedEntity: {
          type: 'withdrawal',
          id: wallet._id
        },
        status: 'pending',
        metadata: {
          paymentMethod: 'bank_transfer',
          bankReference: wallet.bankAccount.accountNumber,
          notes: `Withdrawal request for ${amount} NGN`
        }
      });
      
      res.json({
        success: true,
        message: "Withdrawal request submitted successfully",
        data: {
          transactionId: transaction.transactionId,
          amount: amount,
          fee: withdrawalFee,
          totalDeduction: totalDeduction,
          remainingBalance: wallet.balance,
          estimatedProcessingTime: "1-3 business days"
        }
      });
    });
  } catch (error) {
    await session.abortTransaction();
    throw new Error(error.message);
  } finally {
    await session.endSession();
  }
});

/**
 * @function getWithdrawalHistory
 * @description Get user's withdrawal history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Withdrawal history
 */
const getWithdrawalHistory = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { page = 1, limit = 20 } = req.query;
  
  try {
    const transactions = await Transaction.getTransactionsByUser(_id, parseInt(limit));
    
    // Filter withdrawal transactions
    const withdrawalTransactions = transactions.filter(txn => 
      txn.type === 'wallet_withdrawal'
    );
    
    res.json({
      success: true,
      data: {
        withdrawals: withdrawalTransactions,
        pagination: {
          currentPage: parseInt(page),
          totalTransactions: withdrawalTransactions.length,
          hasMore: withdrawalTransactions.length === parseInt(limit)
        }
      }
    });
  } catch (error) {
    throw new Error(error.message);
  }
});

/**
 * @function getWalletStats
 * @description Get wallet statistics and analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Wallet statistics
 */
const getWalletStats = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  
  try {
    const wallet = await Wallet.getWalletByUser(_id);
    
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }
    
    // Get transaction statistics
    const transactions = await Transaction.find({
      "entries.userId": _id,
      status: 'completed'
    });
    
    const stats = {
      currentBalance: wallet.balance,
      totalEarnings: wallet.metadata.totalEarnings,
      totalWithdrawals: wallet.metadata.totalWithdrawals,
      totalCommissions: wallet.metadata.totalCommissions,
      totalVATCollected: wallet.metadata.totalVATCollected,
      withdrawalLimits: {
        daily: wallet.limits.dailyWithdrawal,
        monthly: wallet.limits.monthlyWithdrawal,
        dailyUsed: wallet.withdrawalStats.dailyWithdrawn.amount,
        monthlyUsed: wallet.withdrawalStats.monthlyWithdrawn.amount
      },
      transactionCount: transactions.length,
      lastTransactionAt: wallet.metadata.lastTransactionAt,
      canWithdraw: wallet.canWithdraw
    };
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    throw new Error(error.message);
  }
});

module.exports = {
  createWallet,
  getWallet,
  updateBankAccount,
  requestWithdrawal,
  getWithdrawalHistory,
  getWalletStats
};
