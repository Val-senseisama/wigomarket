const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const VATConfig = require("../models/vatConfigModel");
const { MakeID } = require("../Helpers/Helpers");
const { PaymentStatus, OrderStatus } = require("../utils/constants");

const calculateCommissionBreakdown =
  require("./paymentController").calculateCommissionBreakdown;

/**
 * @function handleFlutterwaveWebhook
 * @description Handle Flutterwave webhook events (secured with signature verification)
 * This is separated for better organization
 */
const handleFlutterwaveWebhook = asyncHandler(async (req, res) => {
  const crypto = require("crypto");
  const appConfig = require("../config/appConfig");

  const signature = req.headers["verif-hash"] || req.headers["x-flw-signature"];
  const payload = req.body;

  // Verify webhook signature
  const secretHash = appConfig.payment.flutterwave.webhookSecretHash;
  if (!secretHash) {
    console.error("⚠️  FLW_WEBHOOK_SECRET_HASH not configured!");
    return res.status(401).json({
      success: false,
      message: "Webhook configuration error",
    });
  }

  const hash = crypto
    .createHmac("sha256", secretHash)
    .update(JSON.stringify(payload))
    .digest("hex");

  if (hash !== signature) {
    console.error("⚠️  Invalid Flutterwave webhook signature");
    return res.status(401).json({
      success: false,
      message: "Invalid signature",
    });
  }

  try {
    // Handle successful payment event
    if (
      payload.event === "charge.completed" &&
      payload.data.status === "successful"
    ) {
      const { tx_ref, id: transaction_id } = payload.data;

      // Extract orderId from tx_ref (format: order payment intent ID)
      const order = await Order.findOne({ "paymentIntent.id": tx_ref });

      if (!order) {
        console.error(`Order not found for tx_ref: ${tx_ref}`);
        return res
          .status(200)
          .json({ success: false, message: "Order not found" });
      }

      // Check if already processed
      if (order.paymentStatus === PaymentStatus.PAID) {
        console.log(`Payment already processed for order ${order._id}`);
        return res
          .status(200)
          .json({ success: true, message: "Already processed" });
      }

      // Process payment using transaction
      const session = await mongoose.startSession();

      try {
        await session.withTransaction(async () => {
          const fullOrder = await Order.findById(order._id)
            .populate("orderedBy", "fullName email mobile")
            .populate("products.product", "title listedPrice price store")
            .populate("products.store", "name")
            .populate("deliveryAgent", "fullName email mobile")
            .session(session);

          // Calculate commission breakdown
          const commissionData = await calculateCommissionBreakdown(fullOrder);

          // Get VAT configuration
          const vatConfig = await VATConfig.getActiveConfig();
          if (!vatConfig) {
            throw new Error("VAT configuration not found");
          }

          const vatAmount = vatConfig.calculateVAT(
            fullOrder.paymentIntent.amount,
          );
          const vendor = await User.findById(
            fullOrder.products[0].product.store,
          ).session(session);
          const vatResponsibility = vatConfig.getVATResponsibility(
            vendor,
            fullOrder.paymentIntent.amount,
          );

          // Create transaction ledger entry
          const transactionId = `PAY_${Date.now()}_${MakeID(6)}`;
          await Transaction.createTransaction({
            transactionId,
            reference: `Payment-${fullOrder._id}`,
            type: "order_payment",
            totalAmount: fullOrder.paymentIntent.amount,
            entries: [
              {
                account: "cash_account",
                userId: fullOrder.orderedBy._id,
                debit: fullOrder.paymentIntent.amount,
                credit: 0,
                description: `Payment for order ${fullOrder._id}`,
              },
              {
                account: "accounts_receivable",
                userId: fullOrder.orderedBy._id,
                debit: 0,
                credit: fullOrder.paymentIntent.amount,
                description: `Receivable from customer`,
              },
              {
                account: "commission_revenue",
                userId: null,
                debit: commissionData.platformAmount,
                credit: 0,
                description: `Platform commission`,
              },
              {
                account: "accounts_payable",
                userId: null,
                debit: 0,
                credit: commissionData.platformAmount,
                description: `Platform commission payable`,
              },
              {
                account: "commission_payable",
                userId: vendor._id,
                debit: commissionData.vendorAmount,
                credit: 0,
                description: `Vendor earnings`,
              },
              {
                account: "wallet_vendor",
                userId: vendor._id,
                debit: 0,
                credit: commissionData.vendorAmount,
                description: `Vendor wallet credit`,
              },
              ...(commissionData.dispatchAmount > 0
                ? [
                    {
                      account: "commission_payable",
                      userId: fullOrder.deliveryAgent?._id,
                      debit: commissionData.dispatchAmount,
                      credit: 0,
                      description: `Dispatch earnings`,
                    },
                    {
                      account: "wallet_dispatch",
                      userId: fullOrder.deliveryAgent?._id,
                      debit: 0,
                      credit: commissionData.dispatchAmount,
                      description: `Dispatch wallet credit`,
                    },
                  ]
                : []),
              ...(vatAmount > 0
                ? [
                    {
                      account: "vat_payable",
                      userId:
                        vatResponsibility === "platform" ? null : vendor._id,
                      debit: vatAmount,
                      credit: 0,
                      description: `VAT collected`,
                    },
                    {
                      account: "vat_revenue",
                      userId: null,
                      debit: 0,
                      credit: vatAmount,
                      description: `VAT revenue`,
                    },
                  ]
                : []),
            ],
            vat: {
              rate: vatConfig.rates.standard,
              amount: vatAmount,
              responsibility: vatResponsibility,
              collected: true,
            },
            commission: {
              platformRate: commissionData.platformRate,
              platformAmount: commissionData.platformAmount,
              vendorAmount: commissionData.vendorAmount,
              dispatchAmount: commissionData.dispatchAmount,
            },
            relatedEntity: { type: "order", id: fullOrder._id },
            status: "completed",
            metadata: {
              paymentMethod: "flutterwave",
              externalTransactionId: transaction_id,
              notes: `Payment processed via webhook`,
            },
          });

          // Update wallets
          if (commissionData.vendorAmount > 0) {
            let vendorWallet = await Wallet.findOne({
              user: vendor._id,
            }).session(session);
            if (!vendorWallet)
              vendorWallet = await Wallet.createWallet(vendor._id, 0);
            await vendorWallet.addFunds(commissionData.vendorAmount, "earning");
          }

          if (commissionData.dispatchAmount > 0 && fullOrder.deliveryAgent) {
            let dispatchWallet = await Wallet.findOne({
              user: fullOrder.deliveryAgent._id,
            }).session(session);
            if (!dispatchWallet)
              dispatchWallet = await Wallet.createWallet(
                fullOrder.deliveryAgent._id,
                0,
              );
            await dispatchWallet.addFunds(
              commissionData.dispatchAmount,
              "earning",
            );
          }

          // Update order
          await Order.findByIdAndUpdate(
            fullOrder._id,
            {
              paymentStatus: PaymentStatus.PAID,
              "paymentIntent.status": "paid",
              "paymentIntent.flw_ref": transaction_id,
              "paymentIntent.paid_at": new Date(),
              orderStatus: OrderStatus.PENDING,
            },
            { new: true },
          ).session(session);

          console.log(
            `✅ Payment processed for order ${fullOrder._id} via webhook`,
          );
        });
      } catch (error) {
        await session.abortTransaction();
        console.error("Webhook payment processing failed:", error);
      } finally {
        await session.endSession();
      }
    }

    res.status(200).json({ success: true, message: "Webhook received" });
  } catch (error) {
    console.error("Webhook error:", error);
    res
      .status(200)
      .json({ success: false, message: "Webhook processing failed" });
  }
});

module.exports = { handleFlutterwaveWebhook };
