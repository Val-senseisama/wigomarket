/**
 * @file webhookPaymentProcessor.js
 * @description Processes a verified Flutterwave webhook payment event.
 *
 * Called by:
 *   - The BullMQ worker in paymentQueue.js  (when Redis is available)
 *   - A setImmediate fallback in paymentQueue.js  (when Redis is unavailable)
 *
 * This function is intentionally side-effect heavy: it updates the ledger,
 * wallet balances, and order status in a single atomic MongoDB session.
 *
 * IDEMPOTENCY: guarded by the unique `metadata.externalEventId` index on
 * Transaction. Duplicate calls for the same Flutterwave transaction_id are
 * no-ops at the DB level and at the application-logic level (early return).
 */

const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const User = require("../models/userModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const VATConfig = require("../models/vatConfigModel");
const { calculateCommissionBreakdown } = require("./commissionService");
const { PaymentStatus, OrderStatus } = require("../utils/constants");
const { MakeID } = require("../Helpers/Helpers");
const audit = require("./auditService");

/**
 * Process a confirmed Flutterwave payment webhook payload.
 *
 * @param {Object} payload   - Raw Flutterwave webhook body (already signature-verified).
 * @param {string} sourceIp  - IP address from the original request (for audit logs).
 * @returns {Promise<void>}
 */
async function processWebhookPayload(payload, sourceIp = "webhook") {
  // Only handle successful charge events
  if (
    payload.event !== "charge.completed" ||
    payload.data?.status !== "successful"
  ) {
    return;
  }

  const { tx_ref, id: transaction_id } = payload.data;

  const order = await Order.findOne({ "paymentIntent.id": tx_ref });
  if (!order) {
    console.error(`[WebhookProcessor] Order not found for tx_ref: ${tx_ref}`);
    return;
  }

  // Application-level idempotency guard (faster than relying on DB unique constraint)
  const existingTx = await Transaction.findOne({
    "metadata.externalEventId": `FLW_WEBHOOK_${transaction_id}`,
  });
  if (existingTx) {
    console.log(
      `[WebhookProcessor] Already processed event: ${transaction_id}`,
    );
    return;
  }

  if (order.paymentStatus === PaymentStatus.PAID) {
    console.log(
      `[WebhookProcessor] Order ${order._id} already marked paid — skipping`,
    );
    return;
  }

  // Fetch VAT config before opening session (no I/O inside the transaction)
  const vatConfig = await VATConfig.getActiveConfig();

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const fullOrder = await Order.findById(order._id)
        .populate("orderedBy", "fullName email mobile")
        .populate("products.product", "title listedPrice price store")
        .populate("deliveryAgent", "fullName email mobile")
        .session(session);

      if (!fullOrder) throw new Error(`Order ${order._id} not found in session`);

      // Amount mismatch guard — prevents amount-swapping attacks
      if (Math.abs(payload.data.amount - fullOrder.paymentIntent.amount) > 1) {
        audit.error({
          action: "payment.webhook_amount_mismatch",
          actor: { userId: null, role: "system", ip: sourceIp },
          resource: { type: "order", id: fullOrder._id },
          metadata: {
            expected: fullOrder.paymentIntent.amount,
            got: payload.data.amount,
          },
        });
        throw new Error(
          `Amount mismatch: expected ${fullOrder.paymentIntent.amount}, got ${payload.data.amount}`,
        );
      }

      const commissionData = calculateCommissionBreakdown(fullOrder);
      const vatAmount = vatConfig
        ? vatConfig.calculateVAT(fullOrder.paymentIntent.amount)
        : 0;

      const vendor = await User.findById(
        fullOrder.products[0].product.store,
      ).session(session);
      const vatResponsibility =
        vatConfig && vendor
          ? vatConfig.getVATResponsibility(vendor, fullOrder.paymentIntent.amount)
          : "platform";
      const vendorId = vendor?._id ?? fullOrder.products[0].product.store;

      // ── Double-entry ledger ───────────────────────────────────────────────
      const transactionId = `PAY_WH_${Date.now()}_${MakeID(16)}`;
      await Transaction.createTransaction(
        {
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
                    userId: fullOrder.deliveryAgent?._id,
                    debit: commissionData.dispatchAmount,
                    credit: 0,
                    description: "Dispatch earnings",
                  },
                  {
                    account: "wallet_dispatch",
                    userId: fullOrder.deliveryAgent?._id,
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
                    userId:
                      vatResponsibility === "platform" ? null : vendorId,
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
            rate: vatConfig?.rates?.standard ?? 7.5,
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
            externalEventId: `FLW_WEBHOOK_${transaction_id}`,
            notes: "Payment processed via webhook",
          },
        },
        session,
      );

      // ── Credit wallets ────────────────────────────────────────────────────
      if (commissionData.vendorAmount > 0) {
        let vWallet = await Wallet.findOne({ user: vendorId }).session(session);
        if (!vWallet) {
          [vWallet] = await Wallet.create([{ user: vendorId, balance: 0 }], {
            session,
          });
        }
        await vWallet.creditEarning(commissionData.vendorAmount, session);
      }

      if (commissionData.dispatchAmount > 0 && fullOrder.deliveryAgent) {
        let dWallet = await Wallet.findOne({
          user: fullOrder.deliveryAgent._id,
        }).session(session);
        if (!dWallet) {
          [dWallet] = await Wallet.create(
            [{ user: fullOrder.deliveryAgent._id, balance: 0 }],
            { session },
          );
        }
        await dWallet.creditEarning(commissionData.dispatchAmount, session);
      }

      // ── Mark order paid ───────────────────────────────────────────────────
      await Order.findByIdAndUpdate(
        fullOrder._id,
        {
          paymentStatus: PaymentStatus.PAID,
          "paymentIntent.status": "paid",
          "paymentIntent.flw_ref": transaction_id,
          "paymentIntent.paid_at": new Date(),
          "paymentIntent.transaction_id": transactionId,
          orderStatus: OrderStatus.PENDING,
        },
        { session },
      );

      console.log(
        `[WebhookProcessor] ✅ Payment processed for order ${fullOrder._id}`,
      );
    });

    audit.log({
      action: "payment.verified",
      actor: { userId: null, role: "system", ip: sourceIp },
      resource: { type: "order", id: order._id },
      changes: { after: { paymentStatus: "Paid", source: "webhook" } },
      metadata: { externalTransactionId: transaction_id },
    });
  } catch (err) {
    console.error("[WebhookProcessor] Failed:", err.message);
    audit.error({
      action: "payment.webhook_processing_failed",
      actor: { userId: null, role: "system", ip: sourceIp },
      resource: { type: "order", id: order._id },
      metadata: { error: err.message, transaction_id },
    });
    throw err; // Re-throw so BullMQ can schedule a retry
  } finally {
    await session.endSession();
  }
}

module.exports = { processWebhookPayload };
