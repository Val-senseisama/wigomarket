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
const { PaymentStatus, OrderStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");

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
      message: "Order ID is required",
    });
  }

  validateMongodbId(orderId);

  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId)
        .populate("orderedBy", "fullName email mobile")
        .populate("products.product", "title listedPrice price store")
        .populate("products.store", "name")
        .populate("deliveryAgent", "fullName email mobile")
        .session(session);

      if (!order) {
        throw new Error("Order not found");
      }

      if (order.paymentStatus !== PaymentStatus.PAID) {
        throw new Error("Order is not paid, cannot process refund");
      }

      const refundAmount = amount || order.paymentIntent.amount;

      // Process refund with Flutterwave
      const refundData = {
        tx_ref: order.paymentIntent.id,
        amount: refundAmount,
        type: "refund",
      };

      const flwClient = getFlutterwaveInstance();
      const response = await flwClient.Transaction.refund(refundData);

      if (response.status === "success") {
        // Get original transaction for commission reversal
        const originalTransaction = await Transaction.findOne({
          reference: `Payment-${orderId}`,
          type: "order_payment",
        }).session(session);

        if (originalTransaction) {
          // Calculate proportional refunds
          const refundRatio = refundAmount / originalTransaction.totalAmount;
          const platformRefund =
            originalTransaction.commission.platformAmount * refundRatio;
          const vendorRefund =
            originalTransaction.commission.vendorAmount * refundRatio;
          const dispatchRefund =
            originalTransaction.commission.dispatchAmount * refundRatio;
          const vatRefund = originalTransaction.vat.amount * refundRatio;

          // Create refund transaction (session-bound)
          const refundTransactionId = `REF_${Date.now()}_${MakeID(16)}`;
          const refundTransaction = await Transaction.createTransaction(
            {
              transactionId: refundTransactionId,
              reference: `Refund-${orderId}`,
              type: "order_refund",
              totalAmount: refundAmount,
              entries: [
                // Customer refund
                {
                  account: "accounts_receivable",
                  userId: order.orderedBy._id,
                  debit: refundAmount,
                  credit: 0,
                  description: `Refund for order ${orderId}`,
                },
                {
                  account: "cash_account",
                  userId: order.orderedBy._id,
                  debit: 0,
                  credit: refundAmount,
                  description: `Refund payment to customer`,
                },
                // Platform commission reversal
                {
                  account: "commission_revenue",
                  userId: null,
                  debit: 0,
                  credit: platformRefund,
                  description: `Platform commission reversal`,
                },
                {
                  account: "accounts_payable",
                  userId: null,
                  debit: platformRefund,
                  credit: 0,
                  description: `Platform commission refund`,
                },
                // Vendor refund
                {
                  account: "wallet_vendor",
                  userId: order.products[0].product.store,
                  debit: vendorRefund,
                  credit: 0,
                  description: `Vendor refund for order ${orderId}`,
                },
                {
                  account: "commission_payable",
                  userId: order.products[0].product.store,
                  debit: 0,
                  credit: vendorRefund,
                  description: `Vendor commission reversal`,
                },
                // Dispatch refund (if applicable)
                ...(dispatchRefund > 0
                  ? [
                      {
                        account: "wallet_dispatch",
                        userId: order.deliveryAgent?._id,
                        debit: dispatchRefund,
                        credit: 0,
                        description: `Dispatch refund for order ${orderId}`,
                      },
                      {
                        account: "commission_payable",
                        userId: order.deliveryAgent?._id,
                        debit: 0,
                        credit: dispatchRefund,
                        description: `Dispatch commission reversal`,
                      },
                    ]
                  : []),
                // VAT reversal
                ...(vatRefund > 0
                  ? [
                      {
                        account: "vat_payable",
                        userId:
                          originalTransaction.vat.responsibility === "platform"
                            ? null
                            : order.products[0].product.store,
                        debit: 0,
                        credit: vatRefund,
                        description: `VAT reversal for refund`,
                      },
                      {
                        account: "vat_revenue",
                        userId: null,
                        debit: vatRefund,
                        credit: 0,
                        description: `VAT revenue reversal`,
                      },
                    ]
                  : []),
              ],
              relatedEntity: {
                type: "order",
                id: orderId,
              },
              status: "completed",
              metadata: {
                paymentMethod: "refund",
                externalTransactionId: response.data.id,
                externalEventId: `FLW_REFUND_${response.data.id}`,
                notes: `Refund processed: ${reason || "Customer request"}`,
                originalTransactionId: originalTransaction.transactionId,
              },
            },
            session,
          );

          // Deduct from vendor wallet atomically (session-bound)
          if (vendorRefund > 0) {
            const vendorWallet = await Wallet.findOne({
              user: order.products[0].product.store,
            }).session(session);
            if (vendorWallet) {
              await vendorWallet.deductFunds(vendorRefund, "refund", session);
            }
          }

          // Deduct from dispatch wallet atomically (session-bound)
          if (dispatchRefund > 0 && order.deliveryAgent) {
            const dispatchWallet = await Wallet.findOne({
              user: order.deliveryAgent._id,
            }).session(session);
            if (dispatchWallet) {
              await dispatchWallet.deductFunds(
                dispatchRefund,
                "refund",
                session,
              );
            }
          }
        }

        // Restore product stock atomically — return items to inventory.
        // Guard sold >= item.count so a double-refund can never push sold below 0.
        const productUpdates = order.products
          .filter((item) => item.product)
          .map((item) => ({
            updateOne: {
              filter: { _id: item.product._id, sold: { $gte: item.count } },
              update: { $inc: { quantity: item.count, sold: -item.count } },
            },
          }));
        if (productUpdates.length > 0) {
          await Product.bulkWrite(productUpdates, { session });
        }

        // Update order status
        await Order.findByIdAndUpdate(orderId, {
          paymentStatus: PaymentStatus.REFUNDED,
          orderStatus: OrderStatus.CANCELLED,
          "paymentIntent.status": "refunded",
          "paymentIntent.refunded_at": new Date(),
          "paymentIntent.refund_amount": refundAmount,
          "paymentIntent.refund_reason": reason || "Customer request",
        }).session(session);

        audit.log({
          action: "payment.refunded",
          actor: audit.actor(req),
          resource: { type: "order", id: orderId },
          changes: {
            after: {
              refundAmount,
              paymentStatus: "Refunded",
              orderStatus: "Cancelled",
              reason: reason || "Customer request",
            },
          },
          metadata: {
            refund_id: response.data.id,
            transactionId: refundTransaction?.transactionId,
          },
        });

        res.json({
          success: true,
          message: "Refund processed successfully",
          data: {
            refund_id: response.data.id,
            amount: refundAmount,
            status: response.data.status,
            ledger: {
              transactionId: refundTransaction?.transactionId,
              reference: refundTransaction?.reference,
            },
          },
        });
      } else {
        audit.error({
          action: "payment.refund_failed",
          actor: audit.actor(req),
          resource: { type: "order", id: orderId },
          metadata: { flw_error: response.message, amount: refundAmount },
        });
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

module.exports = refundPayment;
