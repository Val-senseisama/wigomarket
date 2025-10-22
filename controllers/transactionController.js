const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const VATConfig = require("../models/vatConfigModel");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const { MakeID } = require("../Helpers/Helpers");

/**
 * @function processOrderPayment
 * @description Process order payment with double-entry accounting
 * @param {string} orderId - Order ID
 * @param {number} totalAmount - Total order amount
 * @param {Object} commissionData - Commission breakdown
 * @param {string} paymentMethod - Payment method used
 * @returns {Object} - Transaction record
 */
const processOrderPayment = asyncHandler(async (orderId, totalAmount, commissionData, paymentMethod = 'card') => {
  const session = await mongoose.startSession();
  
  try {
    let transaction;
    
    await session.withTransaction(async () => {
      // Get VAT configuration
      const vatConfig = await VATConfig.getActiveConfig();
      if (!vatConfig) {
        throw new Error("VAT configuration not found");
      }
      
      // Calculate VAT
      const vatAmount = vatConfig.calculateVAT(totalAmount);
      const netAmount = totalAmount - vatAmount;
      
      // Determine VAT responsibility
      const order = await Order.findById(orderId).populate('products.product').session(session);
      const vendor = await User.findById(order.products[0].product.store).session(session);
      const vatResponsibility = vatConfig.getVATResponsibility(vendor, totalAmount);
      
      // Create transaction ID
      const transactionId = `ORD_${Date.now()}_${MakeID(6)}`;
      
      // Create transaction entries
      const entries = [];
      
      // Customer payment (Debit: Cash/Bank, Credit: Accounts Receivable)
      entries.push({
        account: 'cash_account',
        userId: order.orderedBy,
        debit: totalAmount,
        credit: 0,
        description: `Order payment for order ${orderId}`
      });
      
      entries.push({
        account: 'accounts_receivable',
        userId: order.orderedBy,
        debit: 0,
        credit: totalAmount,
        description: `Receivable from customer for order ${orderId}`
      });
      
      // Platform commission
      if (commissionData.platformAmount > 0) {
        entries.push({
          account: 'commission_revenue',
          userId: null,
          debit: commissionData.platformAmount,
          credit: 0,
          description: `Platform commission from order ${orderId}`
        });
        
        entries.push({
          account: 'accounts_payable',
          userId: null,
          debit: 0,
          credit: commissionData.platformAmount,
          description: `Platform commission payable`
        });
      }
      
      // Vendor earnings
      if (commissionData.vendorAmount > 0) {
        entries.push({
          account: 'commission_payable',
          userId: vendor._id,
          debit: commissionData.vendorAmount,
          credit: 0,
          description: `Vendor earnings for order ${orderId}`
        });
        
        entries.push({
          account: 'wallet_vendor',
          userId: vendor._id,
          debit: 0,
          credit: commissionData.vendorAmount,
          description: `Vendor wallet credit for order ${orderId}`
        });
      }
      
      // Dispatch earnings
      if (commissionData.dispatchAmount > 0) {
        entries.push({
          account: 'commission_payable',
          userId: order.deliveryAgent,
          debit: commissionData.dispatchAmount,
          credit: 0,
          description: `Dispatch earnings for order ${orderId}`
        });
        
        entries.push({
          account: 'wallet_dispatch',
          userId: order.deliveryAgent,
          debit: 0,
          credit: commissionData.dispatchAmount,
          description: `Dispatch wallet credit for order ${orderId}`
        });
      }
      
      // VAT handling
      if (vatAmount > 0) {
        entries.push({
          account: 'vat_payable',
          userId: vatResponsibility === 'platform' ? null : vendor._id,
          debit: vatAmount,
          credit: 0,
          description: `VAT collected for order ${orderId}`
        });
        
        entries.push({
          account: 'vat_revenue',
          userId: null,
          debit: 0,
          credit: vatAmount,
          description: `VAT revenue from order ${orderId}`
        });
      }
      
      // Create transaction
      transaction = await Transaction.createTransaction({
        transactionId,
        reference: `Order-${orderId}`,
        type: 'order_payment',
        entries,
        totalAmount,
        vat: {
          rate: vatConfig.rates.standard,
          amount: vatAmount,
          responsibility: vatResponsibility,
          collected: true
        },
        commission: {
          platformRate: commissionData.platformRate,
          platformAmount: commissionData.platformAmount,
          vendorAmount: commissionData.vendorAmount,
          dispatchAmount: commissionData.dispatchAmount
        },
        relatedEntity: {
          type: 'order',
          id: orderId
        },
        status: 'completed',
        metadata: {
          paymentMethod,
          notes: `Order payment processed with VAT responsibility: ${vatResponsibility}`
        }
      });
      
      // Update vendor wallet if applicable
      if (commissionData.vendorAmount > 0) {
        const vendorWallet = await Wallet.findOne({ user: vendor._id }).session(session);
        if (vendorWallet) {
          await vendorWallet.addFunds(commissionData.vendorAmount, 'earning');
        }
      }
      
      // Update dispatch wallet if applicable
      if (commissionData.dispatchAmount > 0 && order.deliveryAgent) {
        const dispatchWallet = await Wallet.findOne({ user: order.deliveryAgent }).session(session);
        if (dispatchWallet) {
          await dispatchWallet.addFunds(commissionData.dispatchAmount, 'earning');
        }
      }
    });
    
    return transaction;
  } catch (error) {
    await session.abortTransaction();
    throw new Error(error.message);
  } finally {
    await session.endSession();
  }
});

/**
 * @function processRefund
 * @description Process order refund with proper accounting
 * @param {string} orderId - Order ID
 * @param {number} refundAmount - Refund amount
 * @param {string} reason - Refund reason
 * @returns {Object} - Transaction record
 */
const processRefund = asyncHandler(async (orderId, refundAmount, reason = 'Customer request') => {
  const session = await mongoose.startSession();
  
  try {
    let transaction;
    
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).populate('products.product').session(session);
      
      if (!order) {
        throw new Error("Order not found");
      }
      
      // Get original transaction
      const originalTransaction = await Transaction.findOne({
        reference: `Order-${orderId}`,
        type: 'order_payment'
      }).session(session);
      
      if (!originalTransaction) {
        throw new Error("Original transaction not found");
      }
      
      // Calculate proportional refunds
      const refundRatio = refundAmount / originalTransaction.totalAmount;
      const platformRefund = originalTransaction.commission.platformAmount * refundRatio;
      const vendorRefund = originalTransaction.commission.vendorAmount * refundRatio;
      const dispatchRefund = originalTransaction.commission.dispatchAmount * refundRatio;
      const vatRefund = originalTransaction.vat.amount * refundRatio;
      
      // Create refund transaction
      const transactionId = `REF_${Date.now()}_${MakeID(6)}`;
      
      const entries = [
        // Customer refund
        {
          account: 'accounts_receivable',
          userId: order.orderedBy,
          debit: refundAmount,
          credit: 0,
          description: `Refund for order ${orderId}`
        },
        {
          account: 'cash_account',
          userId: order.orderedBy,
          debit: 0,
          credit: refundAmount,
          description: `Refund payment to customer`
        }
      ];
      
      // Platform commission reversal
      if (platformRefund > 0) {
        entries.push({
          account: 'commission_revenue',
          userId: null,
          debit: 0,
          credit: platformRefund,
          description: `Platform commission reversal for refund`
        });
        entries.push({
          account: 'accounts_payable',
          userId: null,
          debit: platformRefund,
          credit: 0,
          description: `Platform commission refund payable`
        });
      }
      
      // Vendor refund
      if (vendorRefund > 0) {
        entries.push({
          account: 'wallet_vendor',
          userId: order.products[0].product.store,
          debit: vendorRefund,
          credit: 0,
          description: `Vendor refund for order ${orderId}`
        });
        entries.push({
          account: 'commission_payable',
          userId: order.products[0].product.store,
          debit: 0,
          credit: vendorRefund,
          description: `Vendor commission reversal`
        });
      }
      
      // Dispatch refund
      if (dispatchRefund > 0 && order.deliveryAgent) {
        entries.push({
          account: 'wallet_dispatch',
          userId: order.deliveryAgent,
          debit: dispatchRefund,
          credit: 0,
          description: `Dispatch refund for order ${orderId}`
        });
        entries.push({
          account: 'commission_payable',
          userId: order.deliveryAgent,
          debit: 0,
          credit: dispatchRefund,
          description: `Dispatch commission reversal`
        });
      }
      
      // VAT reversal
      if (vatRefund > 0) {
        entries.push({
          account: 'vat_payable',
          userId: originalTransaction.vat.responsibility === 'platform' ? null : order.products[0].product.store,
          debit: 0,
          credit: vatRefund,
          description: `VAT reversal for refund`
        });
        entries.push({
          account: 'vat_revenue',
          userId: null,
          debit: vatRefund,
          credit: 0,
          description: `VAT revenue reversal`
        });
      }
      
      transaction = await Transaction.createTransaction({
        transactionId,
        reference: `Refund-${orderId}`,
        type: 'order_refund',
        entries,
        totalAmount: refundAmount,
        relatedEntity: {
          type: 'order',
          id: orderId
        },
        status: 'completed',
        metadata: {
          paymentMethod: 'refund',
          notes: `Refund processed: ${reason}`,
          originalTransactionId: originalTransaction.transactionId
        }
      });
      
      // Update wallets
      if (vendorRefund > 0) {
        const vendorWallet = await Wallet.findOne({ user: order.products[0].product.store }).session(session);
        if (vendorWallet) {
          await vendorWallet.deductFunds(vendorRefund, 'refund');
        }
      }
      
      if (dispatchRefund > 0 && order.deliveryAgent) {
        const dispatchWallet = await Wallet.findOne({ user: order.deliveryAgent }).session(session);
        if (dispatchWallet) {
          await dispatchWallet.deductFunds(dispatchRefund, 'refund');
        }
      }
    });
    
    return transaction;
  } catch (error) {
    await session.abortTransaction();
    throw new Error(error.message);
  } finally {
    await session.endSession();
  }
});

/**
 * @function getTransactionHistory
 * @description Get transaction history for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Transaction history
 */
const getTransactionHistory = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { page = 1, limit = 20, type, startDate, endDate } = req.query;
  
  try {
    const query = { "entries.userId": _id };
    
    if (type) {
      query.type = type;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit) * parseInt(page))
      .populate('audit.createdBy', 'fullName email')
      .populate('audit.approvedBy', 'fullName email');
    
    res.json({
      success: true,
      data: {
        transactions: transactions.slice(0, parseInt(limit)),
        pagination: {
          currentPage: parseInt(page),
          totalTransactions: transactions.length,
          hasMore: transactions.length > parseInt(limit) * parseInt(page)
        }
      }
    });
  } catch (error) {
    throw new Error(error.message);
  }
});

/**
 * @function getVATSummary
 * @description Get VAT summary for admin
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - VAT summary
 */
const getVATSummary = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  try {
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const vatSummary = await Transaction.getVATSummary(start, end);
    
    res.json({
      success: true,
      data: {
        period: { startDate: start, endDate: end },
        summary: vatSummary,
        totalVATCollected: vatSummary.reduce((sum, item) => sum + item.totalVATCollected, 0),
        totalTransactions: vatSummary.reduce((sum, item) => sum + item.totalTransactions, 0)
      }
    });
  } catch (error) {
    throw new Error(error.message);
  }
});

/**
 * @function reverseTransaction
 * @description Reverse a transaction (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.transactionId - Transaction ID to reverse
 * @param {string} req.body.reason - Reason for reversal
 * @returns {Object} - Reversal result
 */
const reverseTransaction = asyncHandler(async (req, res) => {
  const { transactionId } = req.params;
  const { reason } = req.body;
  const { _id } = req.user; // Admin user
  
  try {
    const transaction = await Transaction.findOne({ transactionId });
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }
    
    if (transaction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: "Only completed transactions can be reversed"
      });
    }
    
    const reversedTransaction = await transaction.reverse(reason, _id);
    
    res.json({
      success: true,
      message: "Transaction reversed successfully",
      data: reversedTransaction
    });
  } catch (error) {
    throw new Error(error.message);
  }
});

module.exports = {
  processOrderPayment,
  processRefund,
  getTransactionHistory,
  getVATSummary,
  reverseTransaction
};
