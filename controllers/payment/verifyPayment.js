const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Order = require("../../models/orderModel");
const User = require("../../models/userModel");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");
const VATConfig = require("../../models/vatConfigModel");
const { getFlutterwaveInstance } = require("../../config/flutterwaveClient");
const { calculateCommissionBreakdown } = require("../../services/commissionService");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { MakeID } = require("../../Helpers/Helpers");
const { PaymentStatus, OrderStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");

/**
 * @function verifyPayment
 * @description Verify payment status with Flutterwave and process wallet transactions.
 *
 * DESIGN:
 *   1. Validate inputs.
 *   2. Call FLW API *outside* the MongoDB session — external I/O must never
 *      hold a transaction open.
 *   3. Idempotency check — bail if the order is already paid.
 *   4. All DB writes (Transaction ledger, wallet credits, order update) run
 *      inside a single atomic session.
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { transaction_id, orderId } = req.body;

  if (!transaction_id || !orderId) {
    return res.status(400).json({
      success: false,
      message: "Transaction ID and Order ID are required",
    });
  }

  validateMongodbId(orderId);

  // ── Step 1: Call Flutterwave OUTSIDE the session ──────────────────────────
  const flwClient = getFlutterwaveInstance();
  const response = await flwClient.Transaction.verify({ id: transaction_id });

  if (
    !(response.status === "success" && response.data.status === "successful")
  ) {
    // Mark as failed — simple update, no session needed
    await Order.findByIdAndUpdate(orderId, {
      "paymentIntent.status": "failed",
      "paymentIntent.failed_at": new Date(),
    });

    audit.error({
      action: "payment.verification_failed",
      actor: audit.actor(req),
      resource: { type: "order", id: orderId },
      metadata: { flw_status: response.data?.status, flw_id: transaction_id },
    });

    return res.status(400).json({
      success: false,
      message: "Payment verification failed",
      data: {
        status: response.data?.status || "failed",
        message: response.message || "Payment was not successful",
      },
    });
  }

  // ── Step 2: Idempotency guard — check before opening a session ───────────
  const existing = await Transaction.findOne({
    reference: `Payment-${orderId}`,
    type: "order_payment",
    status: "completed",
  });
  if (existing) {
    return res.status(200).json({
      success: true,
      message: "Payment already processed",
      data: {
        ledger: {
          transactionId: existing.transactionId,
          reference: existing.reference,
        },
      },
    });
  }

  // ── Step 3: Fetch VAT config once, outside session ────────────────────────
  const vatConfig = await VATConfig.getActiveConfig();
  if (!vatConfig) {
    return res
      .status(500)
      .json({ success: false, message: "VAT configuration not found" });
  }

  // ── Step 4: All writes in one atomic session ───────────────────────────────
  const session = await mongoose.startSession();
  let updatedOrder;
  let transactionRecord;
  let commissionData;
  let vatAmount;
  let vatResponsibility;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId)
        .populate("orderedBy", "fullName email mobile")
        .populate("products.product", "title listedPrice price store")
        .populate("deliveryAgent", "fullName email mobile")
        .session(session);

      if (!order) throw new Error("Order not found");

      // Verify amount matches — guard against amount-swapping attacks
      if (Math.abs(response.data.amount - order.paymentIntent.amount) > 1) {
        throw new Error(
          `Amount mismatch: expected ${order.paymentIntent.amount}, got ${response.data.amount}`,
        );
      }

      commissionData = await calculateCommissionBreakdown(order);
      vatAmount = vatConfig.calculateVAT(order.paymentIntent.amount);

      const vendor = await User.findById(
        order.products[0].product.store,
      ).session(session);
      vatResponsibility = vendor
        ? vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount)
        : "platform";

      const vendorId = vendor?._id ?? order.products[0].product.store;

      // ── Ledger ──────────────────────────────────────────────────────────
      const transactionId = `PAY_${Date.now()}_${MakeID(16)}`;
      transactionRecord = await Transaction.createTransaction(
        {
          transactionId,
          reference: `Payment-${orderId}`,
          type: "order_payment",
          totalAmount: order.paymentIntent.amount,
          entries: [
            {
              account: "cash_account",
              userId: order.orderedBy._id,
              debit: order.paymentIntent.amount,
              credit: 0,
              description: `Payment for order ${orderId}`,
            },
            {
              account: "accounts_receivable",
              userId: order.orderedBy._id,
              debit: 0,
              credit: order.paymentIntent.amount,
              description: "Receivable from customer",
            },
            {
              account: "commission_revenue",
              userId: null,
              debit: commissionData.platformAmount,
              credit: 0,
              description: "Platform commission",
            },
            {
              account: "accounts_payable",
              userId: null,
              debit: 0,
              credit: commissionData.platformAmount,
              description: "Platform commission payable",
            },
            {
              account: "commission_payable",
              userId: vendorId,
              debit: commissionData.vendorAmount,
              credit: 0,
              description: "Vendor earnings",
            },
            {
              account: "wallet_vendor",
              userId: vendorId,
              debit: 0,
              credit: commissionData.vendorAmount,
              description: "Vendor wallet credit",
            },
            ...(commissionData.dispatchAmount > 0
              ? [
                  {
                    account: "commission_payable",
                    userId: order.deliveryAgent?._id,
                    debit: commissionData.dispatchAmount,
                    credit: 0,
                    description: "Dispatch earnings",
                  },
                  {
                    account: "wallet_dispatch",
                    userId: order.deliveryAgent?._id,
                    debit: 0,
                    credit: commissionData.dispatchAmount,
                    description: "Dispatch wallet credit",
                  },
                ]
              : []),
            ...(vatAmount > 0
              ? [
                  {
                    account: "vat_payable",
                    userId: vatResponsibility === "platform" ? null : vendorId,
                    debit: vatAmount,
                    credit: 0,
                    description: "VAT collected",
                  },
                  {
                    account: "vat_revenue",
                    userId: null,
                    debit: 0,
                    credit: vatAmount,
                    description: "VAT revenue",
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
          relatedEntity: { type: "order", id: orderId },
          status: "completed",
          metadata: {
            paymentMethod: "flutterwave",
            externalTransactionId: transaction_id,
            externalEventId: `FLW_VERIFY_${transaction_id}`,
            notes: `Payment processed via Flutterwave with VAT responsibility: ${vatResponsibility}`,
          },
        },
        session,
      );

      // ── Wallet credits ───────────────────────────────────────────────────
      if (commissionData.vendorAmount > 0) {
        let vendorWallet = await Wallet.findOne({ user: vendorId }).session(
          session,
        );
        if (!vendorWallet) {
          [vendorWallet] = await Wallet.create(
            [{ user: vendorId, balance: 0 }],
            { session },
          );
        }
        await vendorWallet.creditEarning(commissionData.vendorAmount, session);
      }

      if (commissionData.dispatchAmount > 0 && order.deliveryAgent) {
        let dispatchWallet = await Wallet.findOne({
          user: order.deliveryAgent._id,
        }).session(session);
        if (!dispatchWallet) {
          [dispatchWallet] = await Wallet.create(
            [{ user: order.deliveryAgent._id, balance: 0 }],
            { session },
          );
        }
        await dispatchWallet.creditEarning(
          commissionData.dispatchAmount,
          session,
        );
      }

      // ── Mark order paid (session-bound) ──────────────────────────────────
      updatedOrder = await Order.findByIdAndUpdate(
        orderId,
        {
          paymentStatus: PaymentStatus.PAID,
          "paymentIntent.status": "paid",
          "paymentIntent.flw_ref": transaction_id,
          "paymentIntent.paid_at": new Date(),
          "paymentIntent.transaction_id": transactionRecord.transactionId,
          orderStatus: OrderStatus.PENDING,
        },
        { new: true, session },
      );
    });
  } finally {
    await session.endSession();
  }

  audit.log({
    action: "payment.verified",
    actor: audit.actor(req),
    resource: { type: "order", id: orderId },
    changes: {
      after: {
        paymentStatus: "Paid",
        transactionId: transactionRecord.transactionId,
        amount: response.data.amount,
      },
    },
    metadata: { externalTransactionId: transaction_id },
  });

  res.json({
    success: true,
    message: "Payment verified and processed successfully",
    data: {
      order: updatedOrder,
      payment: {
        transaction_id,
        amount: response.data.amount,
        currency: response.data.currency,
        status: response.data.status,
        paid_at: new Date(),
      },
      commission: commissionData,
      vat: {
        amount: vatAmount,
        responsibility: vatResponsibility,
        rate: vatConfig.rates.standard,
      },
      ledger: {
        transactionId: transactionRecord.transactionId,
        reference: transactionRecord.reference,
      },
    },
  });
});

module.exports = verifyPayment;
