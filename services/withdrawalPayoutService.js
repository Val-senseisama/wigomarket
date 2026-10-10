/**
 * @file withdrawalPayoutService.js
 * @description Pays approved wallet withdrawals out through the payment
 * provider and follows each transfer until the provider says how it ended.
 *
 * A withdrawal's amount + fee leave the wallet when it is requested
 * (controllers/wallet/requestWithdrawal) and the ledger row stays `pending`.
 * Approval only *sends* the transfer; the row becomes `completed` when the
 * provider confirms the money left, through whichever comes first:
 *   - the transfer call itself answering SUCCESS,
 *   - a disbursement webhook (re-verified with the provider's API — a webhook
 *     is only a hint), or
 *   - the payout cron asking the provider by our reference.
 * A transfer the provider fails or the bank reverses returns amount + fee to
 * the wallet, exactly once.
 *
 * The reference is ours and stable per attempt (`WD_<transactionId>`, then
 * `…_R<n>` for a retry after the provider refused to start one), so a timed-out
 * call is followed up by asking about it, never by sending it again.
 */

const mongoose = require("mongoose");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const payments = require("./payments");
const audit = require("./auditService");
const money = require("../utils/money");
const { notifyAdmins } = require("./alertService");
const { MakeID } = require("../Helpers/Helpers");

const SYSTEM = { userId: null, role: "system", ip: "cron" };
// Give a fresh transfer time to settle before asking about it.
const REQUERY_AFTER_MS = 2 * 60 * 1000;
// A transfer the provider has never heard of this long after we sent it never
// arrived: nothing moved, so it may be retried.
const NOT_FOUND_GRACE_MS = 15 * 60 * 1000;
// In transit this long needs a human (e.g. Monnify holding it for an OTP).
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const payoutReference = (txn, attempt) =>
  attempt > 1 ? `WD_${txn.transactionId}_R${attempt}` : `WD_${txn.transactionId}`;

// Real withdrawals. Bill payments are also `wallet_withdrawal` rows (paid to
// VTpass, relatedEntity.type "payment") and must never be paid out to a bank.
const WITHDRAWAL = { type: "wallet_withdrawal", "relatedEntity.type": "withdrawal" };

/**
 * A withdrawal row's totalAmount is everything that left the wallet (payout +
 * fee), because the ledger requires totalAmount to equal its debits.
 */
function amountsOf(txn) {
  const fee = txn.entries.find((e) => e.account === "bank_transfer_fees")?.debit || 0;
  return { amount: money.subtract(txn.totalAmount, fee), fee, totalDeduction: txn.totalAmount };
}
// amountsOf for aggregation pipelines, over a withdrawal row.
const FEE_EXPR = {
  $sum: {
    $map: {
      input: { $filter: { input: "$entries", as: "e", cond: { $eq: ["$$e.account", "bank_transfer_fees"] } } },
      as: "fee",
      in: "$$fee.debit",
    },
  },
};
const AMOUNT_EXPR = { $subtract: ["$totalAmount", FEE_EXPR] };

const ownerOf = (txn) => txn.entries.find((e) => e.account === "wallet_vendor")?.userId;

/**
 * Credit a withdrawal's amount + fee back to its wallet, with the matching
 * ledger row. Must run inside `session`.
 */
async function returnToWallet(txn, session, note) {
  const wallet = await Wallet.findOne({ user: ownerOf(txn) }).session(session);
  if (!wallet) throw new Error("User wallet not found");

  const refundAmount = amountsOf(txn).totalDeduction;
  await wallet.addFunds(refundAmount, "refund", session);

  const reversalTransactionId = `REV_${Date.now()}_${MakeID(16)}`;
  await Transaction.createTransaction(
    {
      transactionId: reversalTransactionId,
      reference: `Reversal-${txn.transactionId}`,
      type: "wallet_deposit",
      totalAmount: refundAmount,
      entries: [
        {
          account: "wallet_vendor",
          userId: wallet.user,
          debit: 0,
          credit: refundAmount,
          description: `Refund for withdrawal ${txn.transactionId}`,
        },
        {
          account: "cash_account",
          userId: wallet.user,
          debit: refundAmount,
          credit: 0,
          description: "Refund payment",
        },
      ],
      relatedEntity: { type: "withdrawal", id: txn._id },
      status: "completed",
      metadata: {
        paymentMethod: "refund",
        notes: note,
        originalTransactionId: txn.transactionId,
      },
    },
    session,
  );
  return { refundAmount, reversalTransactionId };
}

/**
 * Record a provider answer about a payout and act on it. Every transition is
 * conditional on the state it leaves, so webhook, cron and the approving
 * request can all report the same answer and only one of them acts.
 *
 * @returns {Promise<{ result: string }>} completed | failed | reversed | rejected | pending | noop
 */
async function applyTransferStatus(txn, status, { source, actor = SYSTEM }) {
  const now = new Date();
  const seen = { "payout.lastCheckedAt": now, "payout.providerStatus": status.providerStatus ?? null };
  if (status.providerTransferId) seen["payout.providerTransferId"] = status.providerTransferId;

  if (status.outcome === "succeeded") {
    const done = await Transaction.findOneAndUpdate(
      { _id: txn._id, status: "pending", "payout.status": "in_transit" },
      {
        $set: {
          ...seen,
          status: "completed",
          "payout.status": "succeeded",
          "payout.settledAt": now,
          "payout.message": null,
          "metadata.externalTransactionId": status.reference,
          "metadata.notes": `Paid out via ${txn.payout.provider} (${status.providerStatus ?? "confirmed"})`,
        },
      },
      { new: true },
    );
    if (!done) return { result: "noop" };
    audit.log({
      action: "wallet.withdrawal_paid",
      actor,
      resource: { type: "transaction", id: txn.transactionId },
      metadata: { source, provider: txn.payout.provider, reference: status.reference, providerStatus: status.providerStatus },
    });
    return { result: "completed" };
  }

  if (status.outcome === "failed") {
    let outcome = null;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        outcome = null;
        const t = await Transaction.findOne({ _id: txn._id, "payout.status": { $in: ["in_transit", "succeeded"] } }).session(session);
        if (!t) return;
        const wasPaid = t.payout.status === "succeeded";
        const note = wasPaid
          ? `Payout ${t.payout.reference} was reversed by ${t.payout.provider} (${status.providerStatus})`
          : `Payout ${t.payout.reference} failed at ${t.payout.provider}: ${status.message || status.providerStatus}`;
        const refunded = await returnToWallet(t, session, note);
        t.status = wasPaid ? "reversed" : "failed";
        t.payout.status = wasPaid ? "reversed" : "failed";
        t.payout.settledAt = now;
        t.payout.lastCheckedAt = now;
        t.payout.providerStatus = status.providerStatus ?? null;
        t.payout.message = status.message ?? null;
        t.metadata.notes = note;
        await t.save({ session });
        outcome = { result: t.payout.status, ...refunded, note };
      });
    } finally {
      await session.endSession();
    }
    if (!outcome) return { result: "noop" };

    audit.error({
      action: outcome.result === "reversed" ? "wallet.withdrawal_reversed" : "wallet.withdrawal_payout_failed",
      actor,
      resource: { type: "transaction", id: txn.transactionId },
      metadata: {
        source,
        provider: txn.payout.provider,
        providerStatus: status.providerStatus,
        refundAmount: outcome.refundAmount,
        reversalTransactionId: outcome.reversalTransactionId,
      },
    });
    notifyAdmins(
      outcome.result === "reversed" ? "Withdrawal payout reversed" : "Withdrawal payout failed",
      `${outcome.note}. The amount and fee were returned to the user's wallet.`,
      { transactionId: txn.transactionId, refundAmount: outcome.refundAmount },
    ).catch(() => {});
    return { result: outcome.result };
  }

  if (status.outcome === "not_found" && txn.payout.initiatedAt < new Date(now - NOT_FOUND_GRACE_MS)) {
    // The transfer never reached the provider: nothing moved. Hand it back to
    // the admin queue; a retry goes out under a new reference.
    const released = await Transaction.updateOne(
      { _id: txn._id, status: "pending", "payout.status": "in_transit" },
      {
        $set: { ...seen, "payout.status": "rejected", "payout.message": `${txn.payout.provider} has no transfer under ${txn.payout.reference}` },
        $unset: { "audit.approvedBy": "", "audit.approvedAt": "" },
      },
    );
    return { result: released.modifiedCount ? "rejected" : "noop" };
  }

  // Still pending (or not visible yet): note that we asked.
  await Transaction.updateOne({ _id: txn._id, "payout.status": "in_transit" }, { $set: seen });
  return { result: "pending" };
}

/** Ask the provider about one payout and act on the answer. */
async function refreshPayout(txn, { source, actor = SYSTEM, providerTransferId } = {}) {
  const provider = payments.getProvider(txn.payout.provider);
  const status = await provider.getTransferStatus({
    reference: txn.payout.reference,
    providerTransferId: txn.payout.providerTransferId ?? providerTransferId ?? null,
  });
  if (!status) {
    // This provider cannot be asked without its own id; wait for its webhook.
    await Transaction.updateOne({ _id: txn._id }, { $set: { "payout.lastCheckedAt": new Date() } });
    return { result: "unqueryable" };
  }
  return applyTransferStatus(txn, status, { source, actor });
}

/**
 * Send an approved withdrawal to the bank account. The withdrawal is claimed
 * first, so concurrent approvals (or an approve racing a reject) cannot both
 * act, and the payout is on record before any money moves.
 *
 * @returns {Promise<{ outcome, transaction, transfer }>} outcome is
 *   completed | in_transit | unknown | rejected | conflict
 */
async function startPayout({ transactionId, bank, adminId, actor }) {
  const provider = payments.getProvider();
  const now = new Date();
  // One write claims the withdrawal and records the attempt's reference, so a
  // claimed payout can always be looked up. Pipeline form so the reference
  // can be built from the incremented attempt count (payoutReference).
  const attempt = { $add: [{ $ifNull: ["$payout.attempts", 0] }, 1] };
  const claimed = await Transaction.findOneAndUpdate(
    { ...WITHDRAWAL, transactionId, status: "pending", "payout.status": { $ne: "in_transit" } },
    [
      {
        $set: {
          payout: {
            $mergeObjects: [
              "$payout",
              {
                status: "in_transit",
                provider: provider.name,
                initiatedAt: now,
                message: null,
                providerStatus: null,
                providerTransferId: null,
                attempts: attempt,
                reference: {
                  $cond: [
                    { $gt: [attempt, 1] },
                    { $concat: ["WD_", "$transactionId", "_R", { $toString: attempt }] },
                    { $concat: ["WD_", "$transactionId"] },
                  ],
                },
              },
            ],
          },
          "audit.approvedBy": adminId,
          "audit.approvedAt": now,
          "metadata.paymentMethod": provider.name,
        },
      },
    ],
    { new: true },
  );
  if (!claimed) return { outcome: "conflict" };
  const reference = claimed.payout.reference;

  let transfer;
  try {
    transfer = await provider.transfer({
      amount: amountsOf(claimed).amount,
      reference,
      narration: `WigoMarket wallet withdrawal ${transactionId}`,
      bankCode: bank.bankCode,
      accountNumber: bank.accountNumber,
      accountName: bank.accountName,
    });
  } catch (err) {
    // Outcome unknown. It stays in transit; the cron asks about the reference.
    await Transaction.updateOne({ _id: claimed._id, "payout.status": "in_transit" }, { $set: { "payout.message": err.message } });
    audit.error({
      action: "wallet.withdrawal_api_failed",
      actor,
      resource: { type: "transaction", id: transactionId },
      metadata: { provider: provider.name, reference, error: err.message, outcome: "unknown" },
    });
    return { outcome: "unknown", transaction: await Transaction.findById(claimed._id), transfer: { reference, message: err.message } };
  }

  if (transfer.outcome === "failed") {
    // Refused at initiation: nothing moved. Back to the admin queue.
    await Transaction.updateOne(
      { _id: claimed._id, "payout.status": "in_transit" },
      {
        $set: { "payout.status": "rejected", "payout.message": transfer.message, "payout.providerStatus": transfer.providerStatus ?? null },
        $unset: { "audit.approvedBy": "", "audit.approvedAt": "" },
      },
    );
    audit.error({
      action: "wallet.withdrawal_api_failed",
      actor,
      resource: { type: "transaction", id: transactionId },
      metadata: { provider: provider.name, reference, error: transfer.message, providerStatus: transfer.providerStatus },
    });
    return { outcome: "rejected", transaction: await Transaction.findById(claimed._id), transfer };
  }

  const { result } = await applyTransferStatus(claimed, transfer, { source: "approval", actor });
  return {
    outcome: result === "completed" ? "completed" : "in_transit",
    transaction: await Transaction.findById(claimed._id),
    transfer,
  };
}

/**
 * Webhook entry point (via services/paymentQueue). The event only says which
 * payout to look at; what happened is taken from the provider's API.
 */
async function processTransferEvent({ provider, event, sourceIp = "webhook" }) {
  const txn = await Transaction.findOne({
    ...WITHDRAWAL,
    "payout.provider": provider,
    "payout.reference": event.reference,
  });
  if (!txn) {
    console.error(`[PayoutWebhook] No withdrawal for ${provider} reference ${event.reference}`);
    return { result: "withdrawal_not_found" };
  }
  // A reversal can follow a success, so settled-as-paid payouts still listen.
  if (!["in_transit", "succeeded"].includes(txn.payout.status)) return { result: "noop" };
  return refreshPayout(txn, {
    source: "webhook",
    actor: { userId: null, role: "system", ip: sourceIp },
    providerTransferId: event.providerTransferId,
  });
}

/**
 * Cron tick: ask about every payout still in transit, and alert once about
 * any that has been in transit for a day.
 */
async function recoverPayouts() {
  const now = Date.now();
  const inTransit = await Transaction.find({
    ...WITHDRAWAL,
    "payout.status": "in_transit",
    "payout.initiatedAt": { $lt: new Date(now - REQUERY_AFTER_MS) },
  })
    .sort({ "payout.lastCheckedAt": 1 })
    .limit(50);

  for (const txn of inTransit) {
    try {
      await refreshPayout(txn, { source: "cron" });
    } catch (err) {
      console.error(`[Cron] Payout check failed for ${txn.transactionId}:`, err.message);
      audit.error({
        action: "wallet.withdrawal_requery_failed",
        actor: SYSTEM,
        resource: { type: "transaction", id: txn.transactionId },
        metadata: { provider: txn.payout.provider, reference: txn.payout.reference, error: err.message },
      });
    }
  }

  const stale = await Transaction.find({
    ...WITHDRAWAL,
    "payout.status": "in_transit",
    "payout.initiatedAt": { $lt: new Date(now - STALE_AFTER_MS) },
    "payout.staleAlertedAt": { $exists: false },
  }).limit(50);
  for (const txn of stale) {
    const marked = await Transaction.updateOne(
      { _id: txn._id, "payout.staleAlertedAt": { $exists: false } },
      { $set: { "payout.staleAlertedAt": new Date() } },
    );
    if (!marked.modifiedCount) continue;
    await notifyAdmins(
      "Withdrawal payout stuck in transit",
      `Payout ${txn.payout.reference} via ${txn.payout.provider} has not settled after 24 hours (last status: ${txn.payout.providerStatus || "unknown"}). Check it in the provider dashboard; Monnify holds transfers for OTP while 2FA for API disbursements is on.`,
      { transactionId: txn.transactionId, amount: amountsOf(txn).amount, message: txn.payout.message },
    ).catch(() => {});
  }

  return { checked: inTransit.length, alerted: stale.length };
}

module.exports = {
  WITHDRAWAL,
  amountsOf,
  FEE_EXPR,
  AMOUNT_EXPR,
  startPayout,
  returnToWallet,
  applyTransferStatus,
  refreshPayout,
  processTransferEvent,
  recoverPayouts,
  payoutReference,
};
