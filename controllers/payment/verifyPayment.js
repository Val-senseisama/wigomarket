const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Order = require("../../models/orderModel");
const Transaction = require("../../models/transactionModel");
const VATConfig = require("../../models/vatConfigModel");
const { getFlutterwaveInstance } = require("../../config/flutterwaveClient");
const { calculateCommissionBreakdown } = require("../../services/commissionService");
const {
  resolveVendorPayouts,
  creditVendorWallets,
  primaryVendor,
} = require("../../services/vendorPayoutService");
const { orderPaymentEntries } = require("../../services/orderPaymentLedger");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { MakeID } = require("../../Helpers/Helpers");
const { PaymentStatus, OrderStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");
const { publishStoreOrderEvent, EVENT } = require("../../services/storeOrderEvents");

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

      // One payout per store, each to that store's owner.
      const vendorPayouts = await resolveVendorPayouts(order, session);
      const vendor = await primaryVendor(vendorPayouts, session);
      vatResponsibility = vendor
        ? vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount)
        : "platform";

      // Balanced entries; VAT is a memo on `vat`, not ledger lines (see
      // services/orderPaymentLedger).
      const ledger = orderPaymentEntries({ order: order, payouts: vendorPayouts });

      // ── Ledger ──────────────────────────────────────────────────────────
      const transactionId = `PAY_${Date.now()}_${MakeID(16)}`;
      transactionRecord = await Transaction.createTransaction(
        {
          transactionId,
          reference: `Payment-${orderId}`,
          type: "order_payment",
          totalAmount: ledger.totalAmount,
          entries: ledger.entries,
          vat: {
            rate: vatConfig.rates.standard,
            amount: vatAmount,
            responsibility: vatResponsibility,
            collected: true,
          },
          commission: {
            platformRate: commissionData.platformRate,
            platformAmount: ledger.platformAmount,
            vendorAmount: commissionData.vendorAmount,
            // The delivery fee is held, not paid, at this point.
            dispatchAmount: 0,
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
      await creditVendorWallets(vendorPayouts, session);

      // No rider credit here: the delivery fee is held in accounts_payable and
      // paid to the rider on delivery (dispatchEarningsService).

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

  // Committed: a paid card order is new to sellers, so it arrives as
  // order.created on their dashboards (fire-and-forget).
  publishStoreOrderEvent(orderId, EVENT.CREATED);

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
