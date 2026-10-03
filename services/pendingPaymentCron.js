/**
 * @file pendingPaymentCron.js
 * @description Cron job that runs every 5 minutes to recover card payments that
 * were never confirmed (e.g. the buyer's browser closed after paying and the
 * webhook was lost). Works with whichever provider the order checked out with.
 *
 * RACE-CONDITION SAFETY:
 *   Each order is locked atomically with findOneAndUpdate({ processingLock: false })
 *   before being processed, then unlocked when done. This is safe even with multiple
 *   server instances running simultaneously (e.g. PM2 cluster).
 *
 * IDEMPOTENCY:
 *   Booking goes through services/orderPaymentSettlement, which books each
 *   provider charge exactly once across the cron, the webhook and the verify
 *   endpoint. Duplicate runs are a no-op.
 */

const cron = require("node-cron");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const BillPayment = require("../models/billPaymentModel");
const ledgerService = require("./billPaymentLedgerService");
const { PaymentStatus } = require("../utils/constants");
const audit = require("./auditService");
const { settleOrderPayment, findOrderCharge, SettlementError } = require("./orderPaymentSettlement");
const vtpass = require("./vtpassService");

// Checkouts older than this are abandoned; providers expire them well before.
const PENDING_PAYMENT_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Main cron tick: find recent unpaid checkouts, lock them one by one, ask
 * their provider, and book the ones it confirms.
 */
async function runPendingPaymentCheck() {
  console.log("[Cron] 🕐 Checking pending payments...");

  let pendingOrders;
  try {
    pendingOrders = await Order.find({
      paymentStatus: { $in: [PaymentStatus.UNPAID, PaymentStatus.PENDING] },
      "paymentIntent.provider": { $exists: true, $ne: null }, // checkout was at least started
      "paymentIntent.initializedAt": { $gte: new Date(Date.now() - PENDING_PAYMENT_WINDOW_MS) },
      processingLock: { $ne: true }, // Skip already-locked ones
    })
      .select("_id paymentIntent processingLock")
      .sort({ "paymentIntent.initializedAt": -1 })
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

  const actor = { userId: null, role: "system", ip: "cron" };

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

    audit.log({
      action: "payment.recovery_attempt",
      actor,
      resource: { type: "order", id: order._id },
      metadata: { provider: locked.paymentIntent.provider, reference: locked.paymentIntent.reference },
    });

    try {
      const found = await findOrderCharge(locked);
      if (found?.charge.status === "succeeded") {
        // settleOrderPayment releases the lock in the same write that marks it paid.
        await settleOrderPayment({ orderId: order._id, provider: found.provider, charge: found.charge, source: "cron", actor });
      } else {
        // Not yet paid — the next run tries again.
        audit.log({
          action: "payment.recovery_skipped",
          actor,
          resource: { type: "order", id: order._id },
          metadata: { provider: found?.provider, status: found?.charge.status, providerStatus: found?.charge.providerStatus },
          status: "success", // The check succeeded even if the payment is still pending
        });
      }
    } catch (err) {
      // SettlementErrors (amount / reference mismatch) are already alerted.
      if (!(err instanceof SettlementError)) {
        console.error(`[Cron] Error processing order ${order._id}:`, err.message);
        audit.error({
          action: "payment.recovery_failed",
          actor,
          resource: { type: "order", id: order._id },
          metadata: { error: err.message },
        });
      }
    } finally {
      // Release the lock unless settlement already did.
      await Order.updateOne({ _id: order._id, processingLock: true }, { $set: { processingLock: false } });
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
 *   Every  5 min  — push refunds forward (see orderRefundService.recoverRefunds)
 *   Every  5 min  — confirm withdrawal payouts in transit (withdrawalPayoutService.recoverPayouts)
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
    "*/5 * * * *",
    wrap("refund-recovery", () => require("./orderRefundService").recoverRefunds()),
  );
  cron.schedule(
    "*/5 * * * *",
    wrap("payout-recovery", () => require("./withdrawalPayoutService").recoverPayouts()),
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
    "⏰ Crons scheduled: payment-check (5m), refund-recovery (5m), payout-recovery (5m), bill-check (10m), stuck-cleanup (15m), reconciliation (02:00)",
  );
}

module.exports = {
  startCron,
  runPendingPaymentCheck,
  cleanupStuckTransactions,
  runWalletReconciliation,
};
