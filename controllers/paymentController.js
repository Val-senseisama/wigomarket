const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const User = require("../models/userModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const VATConfig = require("../models/vatConfigModel");
const Flutterwave = require('flutterwave-node-v3');
const receiptService = require("../services/receiptService");
const { validateMongodbId } = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError, MakeID } = require("../Helpers/Helpers");

// Initialize Flutterwave
const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);

/**
 * @function calculateCommissionBreakdown
 * @description Calculate commission breakdown for an order
 * @param {Object} order - Order object with populated products
 * @returns {Object} - Commission breakdown
 */
const calculateCommissionBreakdown = async (order) => {
  let totalPlatformCommission = 0;
  let totalVendorAmount = 0;
  let totalDispatchAmount = 0;
  let platformRate = 0;
  
  // Calculate commissions for each product
  for (const item of order.products) {
    const storePrice = item.product.price;
    const listedPrice = item.product.listedPrice;
    const count = item.count;
    
    const storeCommission = storePrice * count;
    const platformCommission = (listedPrice * count) - storeCommission;
    
    totalPlatformCommission += platformCommission;
    totalVendorAmount += storeCommission;
    
    // Calculate platform rate (average)
    if (listedPrice > 0) {
      platformRate += (platformCommission / (listedPrice * count)) * 100;
    }
  }
  
  // Calculate dispatch amount (if delivery agent is assigned)
  if (order.deliveryAgent && order.deliveryFee) {
    totalDispatchAmount = order.deliveryFee;
  }
  
  // Calculate average platform rate
  platformRate = order.products.length > 0 ? platformRate / order.products.length : 0;
  
  return {
    platformRate: Math.round(platformRate * 100) / 100, // Round to 2 decimal places
    platformAmount: Math.round(totalPlatformCommission * 100) / 100,
    vendorAmount: Math.round(totalVendorAmount * 100) / 100,
    dispatchAmount: Math.round(totalDispatchAmount * 100) / 100,
    totalAmount: order.paymentIntent.amount
  };
};

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
      message: "Order ID is required"
    });
  }
  
  validateMongodbId(orderId);
  
  try {
    // Get order details
    const order = await Order.findById(orderId)
      .populate('orderedBy', 'fullName email mobile')
      .populate('products.product', 'title listedPrice')
      .populate('products.store', 'name');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }
    
    // Check if order belongs to user
    if (order.orderedBy._id.toString() !== _id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This order doesn't belong to you."
      });
    }
    
    // Check if order is already paid
    if (order.paymentStatus === "Paid") {
      return res.status(400).json({
        success: false,
        message: "Order is already paid"
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
        name: user.fullName || "Customer"
      },
      customizations: {
        title: "WigoMarket Payment",
        description: `Payment for Order #${order.paymentIntent.id}`,
        logo: process.env.LOGO_URL || "https://via.placeholder.com/150"
      },
      meta: {
        orderId: orderId,
        userId: _id
      }
    };
    
    // Initialize payment with Flutterwave
    const response = await flw.Payment.initialize(paymentData);
    
    if (response.status === "success") {
      // Update order with payment reference
      await Order.findByIdAndUpdate(orderId, {
        "paymentIntent.flw_ref": response.data.flw_ref,
        "paymentIntent.status": "pending"
      });
      
      res.json({
        success: true,
        message: "Payment initialized successfully",
        data: {
          payment_url: response.data.link,
          flw_ref: response.data.flw_ref,
          orderId: orderId,
          amount: totalAmount
        }
      });
    } else {
      throw new Error(response.message || "Payment initialization failed");
    }
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Payment initialization failed");
  }
});

/**
 * @function verifyPayment
 * @description Verify payment status with Flutterwave and process wallet transactions
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.transaction_id - Flutterwave transaction ID
 * @param {string} req.body.orderId - Order ID
 * @returns {Object} - Payment verification response
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { transaction_id, orderId } = req.body;
  
  if (!transaction_id || !orderId) {
    return res.status(400).json({
      success: false,
      message: "Transaction ID and Order ID are required"
    });
  }
  
  validateMongodbId(orderId);
  
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      // Verify payment with Flutterwave
      const response = await flw.Transaction.verify({ id: transaction_id });
      
      if (response.status === "success" && response.data.status === "successful") {
        // Get order with populated data
        const order = await Order.findById(orderId)
          .populate('orderedBy', 'fullName email mobile')
          .populate('products.product', 'title listedPrice price store')
          .populate('products.store', 'name')
          .populate('deliveryAgent', 'fullName email mobile')
          .session(session);
        
        if (!order) {
          throw new Error("Order not found");
        }
        
        // Calculate commission breakdown using existing logic
        const commissionData = await calculateCommissionBreakdown(order);
        
        // Get VAT configuration
        const vatConfig = await VATConfig.getActiveConfig();
        if (!vatConfig) {
          throw new Error("VAT configuration not found");
        }
        
        // Calculate VAT
        const vatAmount = vatConfig.calculateVAT(order.paymentIntent.amount);
        
        // Determine VAT responsibility
        const vendor = await User.findById(order.products[0].product.store).session(session);
        const vatResponsibility = vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount);
        
        // Create transaction ledger entry
        const transactionId = `PAY_${Date.now()}_${MakeID(6)}`;
        const transaction = await Transaction.createTransaction({
          transactionId,
          reference: `Payment-${orderId}`,
          type: 'order_payment',
          totalAmount: order.paymentIntent.amount,
          entries: [
            // Customer payment
            {
              account: 'cash_account',
              userId: order.orderedBy._id,
              debit: order.paymentIntent.amount,
              credit: 0,
              description: `Payment for order ${orderId}`
            },
            {
              account: 'accounts_receivable',
              userId: order.orderedBy._id,
              debit: 0,
              credit: order.paymentIntent.amount,
              description: `Receivable from customer`
            },
            // Platform commission
            {
              account: 'commission_revenue',
              userId: null,
              debit: commissionData.platformAmount,
              credit: 0,
              description: `Platform commission`
            },
            {
              account: 'accounts_payable',
              userId: null,
              debit: 0,
              credit: commissionData.platformAmount,
              description: `Platform commission payable`
            },
            // Vendor earnings
            {
              account: 'commission_payable',
              userId: vendor._id,
              debit: commissionData.vendorAmount,
              credit: 0,
              description: `Vendor earnings`
            },
            {
              account: 'wallet_vendor',
              userId: vendor._id,
              debit: 0,
              credit: commissionData.vendorAmount,
              description: `Vendor wallet credit`
            },
            // Dispatch earnings (if applicable)
            ...(commissionData.dispatchAmount > 0 ? [
              {
                account: 'commission_payable',
                userId: order.deliveryAgent?._id,
                debit: commissionData.dispatchAmount,
                credit: 0,
                description: `Dispatch earnings`
              },
              {
                account: 'wallet_dispatch',
                userId: order.deliveryAgent?._id,
                debit: 0,
                credit: commissionData.dispatchAmount,
                description: `Dispatch wallet credit`
              }
            ] : []),
            // VAT handling
            ...(vatAmount > 0 ? [
              {
                account: 'vat_payable',
                userId: vatResponsibility === 'platform' ? null : vendor._id,
                debit: vatAmount,
                credit: 0,
                description: `VAT collected`
              },
              {
                account: 'vat_revenue',
                userId: null,
                debit: 0,
                credit: vatAmount,
                description: `VAT revenue`
              }
            ] : [])
          ],
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
            paymentMethod: 'flutterwave',
            externalTransactionId: transaction_id,
            notes: `Payment processed via Flutterwave with VAT responsibility: ${vatResponsibility}`
          }
        });
        
        // Update vendor wallet
        if (commissionData.vendorAmount > 0) {
          let vendorWallet = await Wallet.findOne({ user: vendor._id }).session(session);
          if (!vendorWallet) {
            vendorWallet = await Wallet.createWallet(vendor._id, 0);
          }
          await vendorWallet.addFunds(commissionData.vendorAmount, 'earning');
        }
        
        // Update dispatch wallet (if applicable)
        if (commissionData.dispatchAmount > 0 && order.deliveryAgent) {
          let dispatchWallet = await Wallet.findOne({ user: order.deliveryAgent._id }).session(session);
          if (!dispatchWallet) {
            dispatchWallet = await Wallet.createWallet(order.deliveryAgent._id, 0);
          }
          await dispatchWallet.addFunds(commissionData.dispatchAmount, 'earning');
        }
        
        // Update order payment status
        const updatedOrder = await Order.findByIdAndUpdate(
          orderId,
          {
            paymentStatus: "Paid",
            "paymentIntent.status": "paid",
            "paymentIntent.flw_ref": transaction_id,
            "paymentIntent.paid_at": new Date(),
            "paymentIntent.transaction_id": transaction.transactionId,
            orderStatus: "Pending"
          },
          { new: true }
        ).populate('orderedBy', 'fullName email mobile')
         .populate('products.product', 'title listedPrice')
         .populate('products.store', 'name')
         .session(session);
        
        res.json({
          success: true,
          message: "Payment verified and processed successfully",
          data: {
            order: updatedOrder,
            payment: {
              transaction_id: transaction_id,
              amount: response.data.amount,
              currency: response.data.currency,
              status: response.data.status,
              paid_at: new Date()
            },
            commission: commissionData,
            vat: {
              amount: vatAmount,
              responsibility: vatResponsibility,
              rate: vatConfig.rates.standard
            },
            ledger: {
              transactionId: transaction.transactionId,
              reference: transaction.reference
            }
          }
        });
      } else {
        // Payment failed
        await Order.findByIdAndUpdate(orderId, {
          "paymentIntent.status": "failed",
          "paymentIntent.failed_at": new Date()
        }).session(session);
        
        res.status(400).json({
          success: false,
          message: "Payment verification failed",
          data: {
            status: response.data?.status || "failed",
            message: response.message || "Payment was not successful"
          }
        });
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.log(error);
    throw new Error(error.message || "Payment verification failed");
  } finally {
    await session.endSession();
  }
});

/**
 * @function getPaymentStatus
 * @description Get payment status for an order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.orderId - Order ID
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Payment status information
 */
const getPaymentStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { _id } = req.user;
  
  validateMongodbId(orderId);
  
  try {
    const order = await Order.findOne({
      _id: orderId,
      orderedBy: _id
    }).select('paymentIntent paymentStatus orderStatus');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }
    
    res.json({
      success: true,
      data: {
        orderId: orderId,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus,
        paymentIntent: order.paymentIntent
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get payment status");
  }
});

/**
 * @function refundPayment
 * @description Process refund for an order with wallet integration
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.orderId - Order ID to refund
 * @param {string} req.body.amount - Refund amount (optional, defaults to full amount)
 * @param {string} req.body.reason - Refund reason
 * @returns {Object} - Refund processing response
 */
const refundPayment = asyncHandler(async (req, res) => {
  const { orderId, amount, reason } = req.body;
  
  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required"
    });
  }
  
  validateMongodbId(orderId);
  
  const session = await mongoose.startSession();
  
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId)
        .populate('orderedBy', 'fullName email mobile')
        .populate('products.product', 'title listedPrice price store')
        .populate('products.store', 'name')
        .populate('deliveryAgent', 'fullName email mobile')
        .session(session);
      
      if (!order) {
        throw new Error("Order not found");
      }
      
      if (order.paymentStatus !== "Paid") {
        throw new Error("Order is not paid, cannot process refund");
      }
      
      const refundAmount = amount || order.paymentIntent.amount;
      
      // Process refund with Flutterwave
      const refundData = {
        tx_ref: order.paymentIntent.id,
        amount: refundAmount,
        type: "refund"
      };
      
      const response = await flw.Transaction.refund(refundData);
      
      if (response.status === "success") {
        // Get original transaction for commission reversal
        const originalTransaction = await Transaction.findOne({
          reference: `Payment-${orderId}`,
          type: 'order_payment'
        }).session(session);
        
        if (originalTransaction) {
          // Calculate proportional refunds
          const refundRatio = refundAmount / originalTransaction.totalAmount;
          const platformRefund = originalTransaction.commission.platformAmount * refundRatio;
          const vendorRefund = originalTransaction.commission.vendorAmount * refundRatio;
          const dispatchRefund = originalTransaction.commission.dispatchAmount * refundRatio;
          const vatRefund = originalTransaction.vat.amount * refundRatio;
          
          // Create refund transaction
          const refundTransactionId = `REF_${Date.now()}_${MakeID(6)}`;
          const refundTransaction = await Transaction.createTransaction({
            transactionId: refundTransactionId,
            reference: `Refund-${orderId}`,
            type: 'order_refund',
            totalAmount: refundAmount,
            entries: [
              // Customer refund
              {
                account: 'accounts_receivable',
                userId: order.orderedBy._id,
                debit: refundAmount,
                credit: 0,
                description: `Refund for order ${orderId}`
              },
              {
                account: 'cash_account',
                userId: order.orderedBy._id,
                debit: 0,
                credit: refundAmount,
                description: `Refund payment to customer`
              },
              // Platform commission reversal
              {
                account: 'commission_revenue',
                userId: null,
                debit: 0,
                credit: platformRefund,
                description: `Platform commission reversal`
              },
              {
                account: 'accounts_payable',
                userId: null,
                debit: platformRefund,
                credit: 0,
                description: `Platform commission refund`
              },
              // Vendor refund
              {
                account: 'wallet_vendor',
                userId: order.products[0].product.store,
                debit: vendorRefund,
                credit: 0,
                description: `Vendor refund for order ${orderId}`
              },
              {
                account: 'commission_payable',
                userId: order.products[0].product.store,
                debit: 0,
                credit: vendorRefund,
                description: `Vendor commission reversal`
              },
              // Dispatch refund (if applicable)
              ...(dispatchRefund > 0 ? [
                {
                  account: 'wallet_dispatch',
                  userId: order.deliveryAgent?._id,
                  debit: dispatchRefund,
                  credit: 0,
                  description: `Dispatch refund for order ${orderId}`
                },
                {
                  account: 'commission_payable',
                  userId: order.deliveryAgent?._id,
                  debit: 0,
                  credit: dispatchRefund,
                  description: `Dispatch commission reversal`
                }
              ] : []),
              // VAT reversal
              ...(vatRefund > 0 ? [
                {
                  account: 'vat_payable',
                  userId: originalTransaction.vat.responsibility === 'platform' ? null : order.products[0].product.store,
                  debit: 0,
                  credit: vatRefund,
                  description: `VAT reversal for refund`
                },
                {
                  account: 'vat_revenue',
                  userId: null,
                  debit: vatRefund,
                  credit: 0,
                  description: `VAT revenue reversal`
                }
              ] : [])
            ],
            relatedEntity: {
              type: 'order',
              id: orderId
            },
            status: 'completed',
            metadata: {
              paymentMethod: 'refund',
              externalTransactionId: response.data.id,
              notes: `Refund processed: ${reason || 'Customer request'}`,
              originalTransactionId: originalTransaction.transactionId
            }
          });
          
          // Update vendor wallet
          if (vendorRefund > 0) {
            const vendorWallet = await Wallet.findOne({ user: order.products[0].product.store }).session(session);
            if (vendorWallet) {
              await vendorWallet.deductFunds(vendorRefund, 'refund');
            }
          }
          
          // Update dispatch wallet (if applicable)
          if (dispatchRefund > 0 && order.deliveryAgent) {
            const dispatchWallet = await Wallet.findOne({ user: order.deliveryAgent._id }).session(session);
            if (dispatchWallet) {
              await dispatchWallet.deductFunds(dispatchRefund, 'refund');
            }
          }
        }
        
        // Update order status
        await Order.findByIdAndUpdate(orderId, {
          paymentStatus: "Refunded",
          orderStatus: "Cancelled",
          "paymentIntent.status": "refunded",
          "paymentIntent.refunded_at": new Date(),
          "paymentIntent.refund_amount": refundAmount,
          "paymentIntent.refund_reason": reason || "Customer request"
        }).session(session);
        
        res.json({
          success: true,
          message: "Refund processed successfully",
          data: {
            refund_id: response.data.id,
            amount: refundAmount,
            status: response.data.status,
            ledger: {
              transactionId: refundTransaction?.transactionId,
              reference: refundTransaction?.reference
            }
          }
        });
      } else {
        throw new Error(response.message || "Refund processing failed");
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.log(error);
    throw new Error(error.message || "Refund processing failed");
  } finally {
    await session.endSession();
  }
});

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
      .populate('deliveryAgent', 'fullName email mobile');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "No order found for this user"
      });
    }
    
    // Calculate commission breakdown
    const commissionData = await calculateCommissionBreakdown(order);
    
    // Get VAT configuration
    const vatConfig = await VATConfig.getActiveConfig();
    const vatAmount = vatConfig ? vatConfig.calculateVAT(order.paymentIntent.amount) : 0;
    
    // Determine VAT responsibility
    const vendor = await User.findById(order.products[0].product.store);
    const vatResponsibility = vatConfig ? vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount) : 'platform';
    
    // Group commissions by store
    const storeCommissions = {};
    
    order.products.forEach((item) => {
      const storeId = item.product.store._id.toString();
      const storePrice = item.product.price;
      const listedPrice = item.product.listedPrice;
      const count = item.count;
      
      const storeCommission = storePrice * count;
      const platformCommission = (listedPrice * count) - storeCommission;
      
      if (!storeCommissions[storeId]) {
        storeCommissions[storeId] = {
          store: item.product.store,
          storeCommission: 0,
          platformCommission: 0,
          totalAmount: 0
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
      totalAmount: Math.round(item.totalAmount * 100) / 100
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
          rate: vatConfig ? vatConfig.rates.standard : 7.5
        },
        storeCommissions: payblocks,
        dispatch: order.deliveryAgent ? {
          agent: order.deliveryAgent,
          fee: order.deliveryFee || 0
        } : null
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to calculate commissions");
  }
});

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
      .populate('orderedBy', 'fullName email mobile')
      .populate('products.product', 'title listedPrice price store')
      .populate('products.store', 'name')
      .populate('deliveryAgent', 'fullName email mobile');
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }
    
    // Check if user has access to this order
    if (order.orderedBy._id.toString() !== _id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Access denied. This order doesn't belong to you."
      });
    }
    
    // Check if order is paid
    if (order.paymentStatus !== "Paid") {
      return res.status(400).json({
        success: false,
        message: "Receipt can only be generated for paid orders"
      });
    }
    
    // Get transaction data
    const transaction = await Transaction.findOne({
      reference: `Payment-${orderId}`,
      type: 'order_payment'
    });
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found"
      });
    }
    
    // Calculate commission breakdown
    const commissionData = await calculateCommissionBreakdown(order);
    
    // Get VAT configuration
    const vatConfig = await VATConfig.getActiveConfig();
    const vatAmount = vatConfig ? vatConfig.calculateVAT(order.paymentIntent.amount) : 0;
    const vendor = await User.findById(order.products[0].product.store);
    const vatResponsibility = vatConfig ? vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount) : 'platform';
    
    const vatData = {
      rate: vatConfig ? vatConfig.rates.standard : 7.5,
      amount: vatAmount,
      responsibility: vatResponsibility
    };
    
    // Generate PDF receipt
    const pdfPath = await receiptService.generatePaymentReceipt(order, transaction, commissionData, vatData);
    
    // Send PDF file
    res.download(pdfPath, `receipt_${order.paymentIntent.id}.pdf`, (err) => {
      if (err) {
        console.error('Error sending PDF:', err);
        res.status(500).json({
          success: false,
          message: "Failed to download receipt"
        });
      }
    });
    
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to generate receipt");
  }
});

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
        message: "User not found"
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
        message: "No transactions found for the specified period"
      });
    }
    
    // Generate PDF statement
    const pdfPath = await receiptService.generateTransactionStatement(user, transactions, {
      startDate,
      endDate
    });
    
    // Send PDF file
    const filename = `statement_${user._id}_${Date.now()}.pdf`;
    res.download(pdfPath, filename, (err) => {
      if (err) {
        console.error('Error sending PDF:', err);
        res.status(500).json({
          success: false,
          message: "Failed to download statement"
        });
      }
    });
    
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to generate statement");
  }
});

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
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    // Get VAT summary
    const vatSummary = await Transaction.getVATSummary(start, end);
    
    if (!vatSummary || vatSummary.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No VAT data found for the specified period"
      });
    }
    
    // Process VAT summary data
    const processedSummary = {
      totalVATCollected: vatSummary.reduce((sum, item) => sum + item.totalVATCollected, 0),
      totalTransactions: vatSummary.reduce((sum, item) => sum + item.totalTransactions, 0),
      platformVAT: vatSummary.find(item => item._id === 'platform')?.totalVATCollected || 0,
      vendorVAT: vatSummary.find(item => item._id === 'vendor')?.totalVATCollected || 0,
      breakdown: vatSummary
    };
    
    // Generate PDF report
    const pdfPath = await receiptService.generateVATReport(processedSummary, {
      startDate: start,
      endDate: end
    });
    
    // Send PDF file
    const filename = `vat_report_${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}.pdf`;
    res.download(pdfPath, filename, (err) => {
      if (err) {
        console.error('Error sending PDF:', err);
        res.status(500).json({
          success: false,
          message: "Failed to download VAT report"
        });
      }
    });
    
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to generate VAT report");
  }
});

module.exports = { 
  initializePayment,
  verifyPayment,
  getPaymentStatus,
  refundPayment,
  commissionHandler,
  generatePaymentReceipt,
  generateTransactionStatement,
  generateVATReport
};
