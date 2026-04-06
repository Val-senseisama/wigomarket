/**
 * @file pendingPaymentCron.js
 * @description Cron job that runs every 5 minutes to recover pending Flutterwave
 * transactions that were never confirmed (e.g. user's browser crashed after payment).
 *
 * RACE-CONDITION SAFETY:
 *   Each order is locked atomically with findOneAndUpdate({ processingLock: false })
 *   before being processed, then unlocked when done. This is safe even with multiple
 *   server instances running simultaneously (e.g. PM2 cluster).
 *
 * IDEMPOTENCY:
 *   Before crediting any wallet, we check whether a completed Transaction already
 *   exists for the order reference. Duplicate runs are a no-op.
 */

const cron = require("node-cron");
const mongoose = require("mongoose");
const Flutterwave = require("flutterwave-node-v3");
const Order = require("../models/orderModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const VATConfig = require("../models/vatConfigModel");
const User = require("../models/userModel");
const BillPayment = require("../models/billPaymentModel");
const ledgerService = require("./billPaymentLedgerService");
const appConfig = require("../config/appConfig");
const { PaymentStatus, OrderStatus } = require("../utils/constants");
const { MakeID } = require("../Helpers/Helpers");
const audit = require("./auditService");
const { calculateCommissionBreakdown } = require("./commissionService");
const vtpass = require("./vtpassService");

// Lazy FLW instance
let flw = null;
const getFlw = () => {
  if (!flw) {
    const cfg = appConfig.payment.flutterwave;
    if (!cfg.validate()) throw new Error("Flutterwave not configured");
    flw = new Flutterwave(cfg.publicKey, cfg.secretKey);
  }
  return flw;
};

// Commission calculation is provided by services/commissionService.js

/**
 * Process a single confirmed-paid order: credit wallets + write ledger.
 * Wrapped in a MongoDB transaction for atomicity.
 * @param {object} vatConfig - Pre-fetched VAT config (avoid per-order DB query)
 */
async function processConfirmedPayment(order, externalTxId, vatConfig) {
  // Idempotency guard: bail out if a completed transaction already exists
  const existing = await Transaction.findOne({
    reference: `Payment-${order._id}`,
    type: "order_payment",
    status: "completed",
  });
  if (existing) {
    console.log(`[Cron] ⚡ Already processed: order ${order._id} — skipping`);
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const fullOrder = await Order.findById(order._id)
        .populate("orderedBy", "fullName email mobile")
        .populate("products.product", "title listedPrice price store")
        .populate("products.store", "name")
        .populate("deliveryAgent", "fullName email mobile")
        .session(session);

      if (!fullOrder)
        throw new Error(`Order ${order._id} not found in session`);

      const commission = calculateCommissionBreakdown(fullOrder);

      const vatAmount = vatConfig
        ? vatConfig.calculateVAT(fullOrder.paymentIntent.amount)
        : 0;

      const vendor = await User.findById(
        fullOrder.products[0]?.product?.store,
      ).session(session);

      let vatResponsibility = "platform";
      if (vatConfig && vendor) {
        vatResponsibility = vatConfig.getVATResponsibility(
          vendor,
          fullOrder.paymentIntent.amount,
        );
      }

      // ── Double-entry ledger ───────────────────────────────────────────────
      const txId = `PAY_CRON_${Date.now()}_${MakeID(16)}`;
      await Transaction.createTransaction(
        {
          transactionId: txId,
          reference: `Payment-${fullOrder._id}`,
          type: "order_payment",
          totalAmount: fullOrder.paymentIntent.amount,
          entries: [
            {
              account: "cash_account",
              userId: fullOrder.orderedBy._id,
              debit: fullOrder.paymentIntent.amount,
              credit: 0,
              description: `Cron-recovered payment for order ${fullOrder._id}`,
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
              debit: commission.platformAmount,
              credit: 0,
              description: "Platform commission",
            },
            {
              account: "accounts_payable",
              userId: null,
              debit: 0,
              credit: commission.platformAmount,
              description: "Platform commission payable",
            },
            {
              account: "commission_payable",
              userId: vendor?._id,
              debit: commission.vendorAmount,
              credit: 0,
              description: "Vendor earnings",
            },
            {
              account: "wallet_vendor",
              userId: vendor?._id,
              debit: 0,
              credit: commission.vendorAmount,
              description: "Vendor wallet credit",
            },
            ...(commission.dispatchAmount > 0
              ? [
                  {
                    account: "commission_payable",
                    userId: fullOrder.deliveryAgent?._id,
                    debit: commission.dispatchAmount,
                    credit: 0,
                    description: "Dispatch earnings",
                  },
                  {
                    account: "wallet_dispatch",
                    userId: fullOrder.deliveryAgent?._id,
                    debit: 0,
                    credit: commission.dispatchAmount,
                    description: "Dispatch wallet credit",
                  },
                ]
              : []),
            ...(vatAmount > 0
              ? [
                  {
                    account: "vat_payable",
                    userId:
                      vatResponsibility === "platform" ? null : vendor?._id,
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
            rate: vatConfig?.rates?.standard || 7.5,
            amount: vatAmount,
            responsibility: vatResponsibility,
            collected: true,
          },
          commission,
          relatedEntity: { type: "order", id: fullOrder._id },
          status: "completed",
          metadata: {
            paymentMethod: "flutterwave",
            externalTransactionId: externalTxId,
            externalEventId: `FLW_CRON_${externalTxId}`, // Database-level idempotency guard
            notes: "Recovered by 5-min pending-payment cron",
          },
        },
        session,
      );

      // ── Credit wallets ────────────────────────────────────────────────────
      if (commission.vendorAmount > 0 && vendor) {
        let vWallet = await Wallet.findOne({ user: vendor._id }).session(
          session,
        );
        if (!vWallet) {
          [vWallet] = await Wallet.create([{ user: vendor._id, balance: 0 }], {
            session,
          });
        }
        await vWallet.creditEarning(commission.vendorAmount, session);
      }

      if (commission.dispatchAmount > 0 && fullOrder.deliveryAgent) {
        let dWallet = await Wallet.findOne({
          user: fullOrder.deliveryAgent._id,
        }).session(session);
        if (!dWallet) {
          [dWallet] = await Wallet.create(
            [{ user: fullOrder.deliveryAgent._id, balance: 0 }],
            { session },
          );
        }
        await dWallet.creditEarning(commission.dispatchAmount, session);
      }

      // ── Mark order paid ───────────────────────────────────────────────────
      await Order.findByIdAndUpdate(
        fullOrder._id,
        {
          paymentStatus: PaymentStatus.PAID,
          "paymentIntent.status": "paid",
          "paymentIntent.flw_ref": externalTxId,
          "paymentIntent.paid_at": new Date(),
          "paymentIntent.transaction_id": txId,
          orderStatus: OrderStatus.PENDING,
          processingLock: false,
        },
        { session },
      );

      console.log(`[Cron] ✅ Recovered payment for order ${fullOrder._id}`);
    });

    audit.log({
      action: "payment.verified",
      actor: { userId: null, role: "system", ip: "cron" },
      resource: { type: "order", id: order._id },
      changes: {
        after: { paymentStatus: "Paid", recoveredBy: "pending-payment-cron" },
      },
      metadata: { externalTransactionId: externalTxId },
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Main cron tick: find pending orders, lock them one by one, verify with FLW.
 */
async function runPendingPaymentCheck() {
  console.log("[Cron] 🕐 Checking pending payments...");

  let pendingOrders;
  try {
    pendingOrders = await Order.find({
      paymentStatus: { $in: [PaymentStatus.UNPAID, PaymentStatus.PENDING] },
      "paymentIntent.flw_ref": { $exists: true, $ne: null }, // Only if FLW was at least initialised
      processingLock: { $ne: true }, // Skip already-locked ones
    })
      .select(
        "_id paymentIntent processingLock deliveryAgent deliveryFee products",
      )
      .limit(50); // safety cap per run
  } catch (err) {
    console.error("[Cron] Failed to fetch pending orders:", err.message);
    return;
  }

  if (!pendingOrders.length) {
    console.log("[Cron] ✅ No pending orders found.");
    return;
  }

  console.log(`[Cron] Found ${pendingOrders.length} pending order(s) to check`);

  // Fetch VAT config once — shared across all orders this run
  const vatConfig = await VATConfig.getActiveConfig();

  for (const order of pendingOrders) {
    // ── Atomic lock: only proceed if we won the race ──────────────────────
    const locked = await Order.findOneAndUpdate(
      { _id: order._id, processingLock: { $ne: true } }, // condition
      { $set: { processingLock: true } }, // lock
      { new: true },
    );

    if (!locked) {
      // Another instance/process already grabbed this order
      console.log(
        `[Cron] ⏭  Order ${order._id} already being processed — skipping`,
      );
      continue;
    }

    // Log the start of an attempt
    audit.log({
      action: "payment.recovery_attempt",
      actor: { userId: null, role: "system", ip: "cron" },
      resource: { type: "order", id: order._id },
      metadata: { flw_ref: order.paymentIntent.flw_ref },
    });

    try {
      const flwClient = getFlw();
      const response = await flwClient.Transaction.verify({
        id: order.paymentIntent.flw_ref, // the transaction_id Flutterwave gave us
      });

      if (
        response.status === "success" &&
        response.data.status === "successful" &&
        response.data.tx_ref === order.paymentIntent.id
      ) {
        // Verify the amount matches — safety against amount-swapping attacks
        const expectedAmount = order.paymentIntent.amount;
        const paidAmount = response.data.amount;
        if (Math.abs(paidAmount - expectedAmount) > 1) {
          console.warn(
            `[Cron] ⚠️  Amount mismatch for order ${order._id}: expected ${expectedAmount}, got ${paidAmount}`,
          );
          await Order.updateOne(
            { _id: order._id },
            { $set: { processingLock: false } },
          );
          continue;
        }

        await processConfirmedPayment(order, response.data.id, vatConfig);
      } else {
        // Not yet paid — unlock so next run can try again
        audit.log({
          action: "payment.recovery_skipped",
          actor: { userId: null, role: "system", ip: "cron" },
          resource: { type: "order", id: order._id },
          metadata: {
            flw_status: response.data.status,
            response: response.status,
          },
          status: "success", // The check succeeded even if the payment is still pending
        });
        await Order.updateOne(
          { _id: order._id },
          { $set: { processingLock: false } },
        );
      }
    } catch (err) {
      console.error(`[Cron] Error processing order ${order._id}:`, err.message);
      audit.error({
        action: "payment.recovery_failed",
        actor: { userId: null, role: "system", ip: "cron" },
        resource: { type: "order", id: order._id },
        metadata: { error: err.message },
      });
      // Release lock so it retries next run
      await Order.updateOne(
        { _id: order._id },
        { $set: { processingLock: false } },
      );
    }
  }

  console.log("[Cron] ✅ Pending payment check complete.");
}

/**
 * Mark any 'processing' transaction that has been stuck for > 10 minutes as
 * 'abandoned'. This cleans up transactions that were left in-flight due to
 * crashes or unhandled errors.
 *
 * Safe to run frequently — uses a single updateMany with a time-based filter.
 */
async function cleanupStuckTransactions() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
  try {
    const result = await Transaction.updateMany(
      { status: "processing", updatedAt: { $lt: cutoff } },
      { $set: { status: "abandoned" } },
    );
    if (result.modifiedCount > 0) {
      console.log(
        `[Cron] ⚠️  Abandoned ${result.modifiedCount} stuck transaction(s)`,
      );
      audit.error({
        action: "transaction.abandoned",
        actor: { userId: null, role: "system", ip: "cron" },
        metadata: { count: result.modifiedCount, cutoff },
      });
    }
  } catch (err) {
    console.error("[Cron] Stuck-transaction cleanup failed:", err.message);
  }
}

/**
 * Bill Payment Requery Tick: finds pending VTpass purchases and verifies status.
 */
async function runBillPaymentCheck() {
  console.log("[Cron] 🧾 Checking pending bill payments...");
  try {
    const pendingBills = await BillPayment.findPendingForRequery(10);
    if (!pendingBills.length) {
      console.log("[Cron] ✅ No pending bill payments found.");
      return;
    }

    console.log(`[Cron] Found ${pendingBills.length} pending bill(s) to check`);

    for (const bill of pendingBills) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const res = await vtpass.requeryTransaction(bill.requestId);
          const code = res?.code;
          const deliveredStatus = res?.content?.transactions?.status;
          let finalStatus = "pending";

          if (code === "000") {
            if (
              deliveredStatus === "delivered" ||
              deliveredStatus === "successful"
            ) {
              finalStatus = "completed";
              bill.vtpassResponse = res;
              if (res.content?.transactions?.token || res.purchased_code) {
                bill.deliveryToken =
                  res.content?.transactions?.token || res.purchased_code;
              }
            } else if (deliveredStatus === "failed") {
              finalStatus = "failed";
            }
          } else if (code === "016" || code === "011") {
            finalStatus = "failed";
          }

          if (finalStatus === "completed") {
            await ledgerService.completeBillTransaction(bill, session);
          } else if (finalStatus === "failed") {
            await ledgerService.refundBillTransaction(bill, session);
          }
        });
      } catch (err) {
        console.error(
          `[Cron] Requery failed for bill ${bill.requestId}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("[Cron] Bill check failed:", err.message);
  }
}

/** Helper to refund a failed bill atomically. */
async function refundBill(bill, vtRes) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({ user: bill.user }).session(session);
      if (wallet) {
        await wallet.creditEarning(bill.amount, session, false);
      }
      bill.status = "refunded";
      bill.refundedAt = new Date();
      bill.vtpassResponse = vtRes;
      await bill.save({ session });
      console.log(`[Cron] 🔄 Bill ${bill.requestId} refunded due to failure`);
    });
  } finally {
    await session.endSession();
  }
}

/**
 * Run the wallet health reconciliation: compare each wallet's stored balance
 * against the balance derived from the transaction ledger. Log any drift.
 *
 * This is the automatic complement to auditService.verifyWalletHealth().
 * Runs daily at 02:00 to avoid peak traffic.
 */
async function runWalletReconciliation() {
  console.log("[Cron] Starting daily wallet reconciliation...");
  try {
    await audit.verifyWalletHealth();
    console.log("[Cron] Wallet reconciliation complete.");
  } catch (err) {
    console.error("[Cron] Wallet reconciliation failed:", err.message);
    audit.error({
      action: "cron.reconciliation_failed",
      actor: { userId: null, role: "system", ip: "cron" },
      metadata: { error: err.message },
    });
  }
}

/**
 * Register all cron schedules.
 * Call once from app.js after the DB connection is ready.
 *
 *   Every  5 min  — recover pending payments
 *   Every 15 min  — clean up stuck 'processing' transactions
 *   Daily  02:00  — wallet health reconciliation
 */
function startCron() {
  const wrap = (name, fn) => async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`CRITICAL: Cron "${name}" failed:`, err.message);
      audit.error({
        action: "cron.execution_error",
        actor: { userId: null, role: "system", ip: "cron" },
        metadata: { cron: name, error: err.message, stack: err.stack },
      });
    }
  };

  cron.schedule(
    "*/5 * * * *",
    wrap("pending-payment-check", runPendingPaymentCheck),
  );
  cron.schedule(
    "*/10 * * * *",
    wrap("bill-payment-check", runBillPaymentCheck),
  );
  cron.schedule(
    "*/15 * * * *",
    wrap("stuck-transaction-cleanup", cleanupStuckTransactions),
  );
  cron.schedule(
    "0 2 * * *",
    wrap("wallet-reconciliation", runWalletReconciliation),
  );

  console.log(
    "⏰ Crons scheduled: payment-check (5m), bill-check (10m), stuck-cleanup (15m), reconciliation (02:00)",
  );
}

module.exports = {
  startCron,
  runPendingPaymentCheck,
  cleanupStuckTransactions,
  runWalletReconciliation,
};
