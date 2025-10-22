const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const User = require("../models/userModel");
const Flutterwave = require('flutterwave-node-v3');
const { MakeID } = require("../Helpers/Helpers");

// Initialize Flutterwave
const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);

/**
 * @function processWithdrawal
 * @description Process withdrawal request (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.transactionId - Transaction ID to process
 * @param {string} req.body.action - Action to take (approve, reject)
 * @param {string} req.body.reason - Reason for action
 * @returns {Object} - Processing result
 */
const processWithdrawal = asyncHandler(async (req, res) => {
  const { transactionId } = req.params;
  const { action, reason } = req.body;
  const { _id: adminId } = req.user;
  
  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({
      success: false,
      message: "Action must be 'approve' or 'reject'"
    });
  }
  
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Find the withdrawal transaction
      const transaction = await Transaction.findOne({
        transactionId,
        type: 'wallet_withdrawal',
        status: 'pending'
      }).session(session);
      
      if (!transaction) {
        throw new Error("Withdrawal transaction not found or already processed");
      }
      
      // Get user wallet
      const wallet = await Wallet.findOne({
        user: transaction.entries.find(e => e.account === 'wallet_vendor')?.userId
      }).session(session);
      
      if (!wallet) {
        throw new Error("User wallet not found");
      }
      
      if (action === 'approve') {
        // Process withdrawal via Flutterwave
        const transferData = {
          account_bank: wallet.bankAccount.bankCode,
          account_number: wallet.bankAccount.accountNumber,
          amount: transaction.totalAmount,
          narration: `Withdrawal from WigoMarket wallet - ${transactionId}`,
          currency: "NGN",
          reference: `WD_${transactionId}`,
          callback_url: `${process.env.API_URL}/api/webhooks/transfer`,
          debit_currency: "NGN"
        };
        
        const transferResponse = await flw.Transfer.initiate(transferData);
        
        if (transferResponse.status === 'success') {
          // Update transaction status
          transaction.status = 'completed';
          transaction.audit.approvedBy = adminId;
          transaction.audit.approvedAt = new Date();
          transaction.metadata.externalTransactionId = transferResponse.data.reference;
          transaction.metadata.notes = `Withdrawal approved and processed via Flutterwave`;
          
          await transaction.save();
          
          res.json({
            success: true,
            message: "Withdrawal approved and processed successfully",
            data: {
              transactionId: transaction.transactionId,
              amount: transaction.totalAmount,
              flwReference: transferResponse.data.reference,
              status: 'completed'
            }
          });
        } else {
          throw new Error(transferResponse.message || "Transfer initiation failed");
        }
      } else {
        // Reject withdrawal
        transaction.status = 'cancelled';
        transaction.audit.approvedBy = adminId;
        transaction.audit.approvedAt = new Date();
        transaction.metadata.notes = `Withdrawal rejected: ${reason || 'No reason provided'}`;
        
        // Refund the withdrawal amount back to wallet
        const withdrawalAmount = transaction.totalAmount;
        const withdrawalFee = transaction.entries.find(e => e.account === 'bank_transfer_fees')?.debit || 0;
        const refundAmount = withdrawalAmount + withdrawalFee;
        
        await wallet.addFunds(refundAmount, 'refund');
        
        // Create reversal transaction
        const reversalTransactionId = `REV_${Date.now()}_${MakeID(6)}`;
        await Transaction.createTransaction({
          transactionId: reversalTransactionId,
          reference: `Reversal-${transactionId}`,
          type: 'wallet_deposit',
          totalAmount: refundAmount,
          entries: [
            {
              account: 'wallet_vendor',
              userId: wallet.user,
              debit: 0,
              credit: refundAmount,
              description: `Refund for rejected withdrawal ${transactionId}`
            },
            {
              account: 'cash_account',
              userId: wallet.user,
              debit: refundAmount,
              credit: 0,
              description: `Refund payment`
            }
          ],
          relatedEntity: {
            type: 'withdrawal',
            id: transaction._id
          },
          status: 'completed',
          metadata: {
            paymentMethod: 'refund',
            notes: `Refund for rejected withdrawal: ${reason || 'No reason provided'}`,
            originalTransactionId: transactionId
          }
        });
        
        await transaction.save();
        
        res.json({
          success: true,
          message: "Withdrawal rejected and refunded successfully",
          data: {
            transactionId: transaction.transactionId,
            refundAmount: refundAmount,
            status: 'cancelled',
            reversalTransactionId: reversalTransactionId
          }
        });
      }
    });
  } catch (error) {
    await session.abortTransaction();
    throw new Error(error.message || "Failed to process withdrawal");
  } finally {
    await session.endSession();
  }
});

/**
 * @function getPendingWithdrawals
 * @description Get all pending withdrawal requests (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Pending withdrawals list
 */
const getPendingWithdrawals = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  
  try {
    const withdrawals = await Transaction.find({
      type: 'wallet_withdrawal',
      status: 'pending'
    })
    .populate('entries.userId', 'fullName email mobile')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit) * parseInt(page));
    
    const formattedWithdrawals = withdrawals.map(withdrawal => {
      const user = withdrawal.entries.find(e => e.account === 'wallet_vendor')?.userId;
      const fee = withdrawal.entries.find(e => e.account === 'bank_transfer_fees')?.debit || 0;
      
      return {
        transactionId: withdrawal.transactionId,
        reference: withdrawal.reference,
        user: user,
        amount: withdrawal.totalAmount,
        fee: fee,
        totalDeduction: withdrawal.totalAmount + fee,
        createdAt: withdrawal.createdAt,
        metadata: withdrawal.metadata
      };
    });
    
    res.json({
      success: true,
      data: {
        withdrawals: formattedWithdrawals.slice(0, parseInt(limit)),
        pagination: {
          currentPage: parseInt(page),
          totalWithdrawals: formattedWithdrawals.length,
          hasMore: formattedWithdrawals.length > parseInt(limit) * parseInt(page)
        }
      }
    });
  } catch (error) {
    throw new Error(error.message || "Failed to get pending withdrawals");
  }
});

/**
 * @function getWithdrawalStats
 * @description Get withdrawal statistics (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Withdrawal statistics
 */
const getWithdrawalStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  try {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const stats = await Transaction.aggregate([
      {
        $match: {
          type: 'wallet_withdrawal',
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);
    
    const totalStats = await Transaction.aggregate([
      {
        $match: {
          type: 'wallet_withdrawal',
          createdAt: { $gte: start, $lte: end }
        }
      },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalFees: { 
            $sum: {
              $sum: {
                $map: {
                  input: '$entries',
                  as: 'entry',
                  cond: { $eq: ['$$entry.account', 'bank_transfer_fees'] },
                  in: '$$entry.debit'
                }
              }
            }
          }
        }
      }
    ]);
    
    res.json({
      success: true,
      data: {
        period: { startDate: start, endDate: end },
        statusBreakdown: stats,
        totals: totalStats[0] || {
          totalCount: 0,
          totalAmount: 0,
          totalFees: 0
        }
      }
    });
  } catch (error) {
    throw new Error(error.message || "Failed to get withdrawal statistics");
  }
});

module.exports = {
  processWithdrawal,
  getPendingWithdrawals,
  getWithdrawalStats
};
