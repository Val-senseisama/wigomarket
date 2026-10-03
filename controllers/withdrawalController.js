const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const payoutService = require("../services/withdrawalPayoutService");
const audit = require("../services/auditService");
const money = require("../utils/money");

/**
 * @function processWithdrawal
 * @description Process withdrawal request (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.transactionId - Transaction ID to process
 * @param {string} req.body.action - Action to take (approve, reject)
 * @param {string} req.body.reason - Reason for action
 * @returns {Object} - Processing result
 */
const processWithdrawal = asyncHandler(async (req, res) => {
  const { transactionId } = req.params;
  const { action, reason } = req.body;
  const { _id: adminId } = req.user;

  if (!action || !["approve", "reject"].includes(action)) {
    return res.status(400).json({
      success: false,
      message: "Action must be 'approve' or 'reject'",
    });
  }

  const transaction = await Transaction.findOne({
    ...payoutService.WITHDRAWAL,
    transactionId,
    status: "pending",
  });
  if (!transaction) {
    return res.status(404).json({
      success: false,
      message: "Withdrawal transaction not found or already processed",
    });
  }

  const walletUserId = transaction.entries.find(
    (e) => e.account === "wallet_vendor",
  )?.userId;
  const wallet = await Wallet.findOne({ user: walletUserId });
  if (!wallet) {
    return res
      .status(404)
      .json({ success: false, message: "User wallet not found" });
  }

  // Money may be moving: it settles through the payout webhook / cron.
  if (transaction.payout?.status === "in_transit") {
    return res.status(409).json({
      success: false,
      message: "This withdrawal is already being paid out",
    });
  }

  if (action === "approve") {
    const defaultBank = wallet.defaultBankAccount;
    if (!defaultBank) {
      return res.status(400).json({
        success: false,
        message: "User wallet has no configured bank account",
      });
    }

    const { outcome, transaction: txn, transfer } = await payoutService.startPayout({
      transactionId,
      bank: defaultBank,
      adminId,
      actor: audit.actor(req),
    });

    if (outcome === "conflict") {
      return res.status(409).json({
        success: false,
        message: "Withdrawal already processed or being paid out by another request",
      });
    }
    if (outcome === "rejected") {
      return res.status(502).json({
        success: false,
        message: transfer.message || "Transfer initiation failed",
      });
    }

    audit.log({
      action: "wallet.withdrawal_approved",
      actor: audit.actor(req),
      resource: { type: "transaction", id: transactionId },
      changes: { after: { action, reason: reason || null, status: txn.status, payoutStatus: txn.payout.status } },
    });

    const completed = outcome === "completed";
    return res.status(completed ? 200 : 202).json({
      success: true,
      message: completed
        ? "Withdrawal approved and paid out"
        : outcome === "unknown"
          ? "Withdrawal approved; the provider did not answer in time. The payout will be confirmed automatically."
          : "Withdrawal approved; the transfer is in progress and will be confirmed automatically.",
      data: {
        transactionId: txn.transactionId,
        amount: payoutService.amountsOf(txn).amount,
        provider: txn.payout.provider,
        providerReference: txn.payout.reference,
        providerStatus: txn.payout.providerStatus ?? null,
        payoutStatus: txn.payout.status,
        status: txn.status,
      },
    });
  }

  // ── Reject: return the deducted amount + fee to the wallet atomically ─────
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      // Re-fetch inside the session; a payout in transit cannot be rejected.
      const txn = await Transaction.findOne({
        ...payoutService.WITHDRAWAL,
        transactionId,
        status: "pending",
        "payout.status": { $ne: "in_transit" },
      }).session(session);
      if (!txn)
        throw new Error("Withdrawal already processed or being paid out by another request");

      const note = `Refund for rejected withdrawal: ${reason || "No reason provided"}`;
      const { refundAmount, reversalTransactionId } = await payoutService.returnToWallet(txn, session, note);

      txn.status = "cancelled";
      txn.audit.approvedBy = adminId;
      txn.audit.approvedAt = new Date();
      txn.metadata.notes = `Withdrawal rejected: ${reason || "No reason provided"}`;
      await txn.save({ session });

      result = {
        message: "Withdrawal rejected and refunded successfully",
        data: {
          transactionId: txn.transactionId,
          refundAmount,
          status: "cancelled",
          reversalTransactionId,
        },
      };
    });
  } finally {
    await session.endSession();
  }

  audit.log({
    action: "wallet.withdrawal_rejected",
    actor: audit.actor(req),
    resource: { type: "transaction", id: transactionId },
    changes: {
      after: { action, reason: reason || null, status: "cancelled" },
    },
  });

  res.json({ success: true, ...result });
});

/**
 * @function getPendingWithdrawals
 * @description Get all pending withdrawal requests (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Pending withdrawals list
 */
const getPendingWithdrawals = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  // Payouts already in transit are no longer awaiting a decision.
  const query = { ...payoutService.WITHDRAWAL, status: "pending", "payout.status": { $ne: "in_transit" } };

  const [withdrawals, total] = await Promise.all([
    Transaction.find(query)
      .populate("entries.userId", "fullName email mobile")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Transaction.countDocuments(query),
  ]);

  const formatted = withdrawals.map((w) => {
    const user = w.entries.find((e) => e.account === "wallet_vendor")?.userId;
    const { amount, fee, totalDeduction } = payoutService.amountsOf(w);
    return {
      transactionId: w.transactionId,
      reference: w.reference,
      user,
      amount,
      fee,
      totalDeduction,
      createdAt: w.createdAt,
      metadata: w.metadata,
      // Set when an earlier payout attempt was refused by the provider.
      payout: w.payout?.status ? w.payout : null,
    };
  });

  res.json({
    success: true,
    data: {
      withdrawals: formatted,
      pagination: {
        currentPage: page,
        totalWithdrawals: total,
        hasMore: skip + formatted.length < total,
      },
    },
  });
});

/**
 * @function getWithdrawalStats
 * @description Get withdrawal statistics (admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Withdrawal statistics
 */
const getWithdrawalStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  try {
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    // totalAmount is what the banks receive; totalFees is what we kept;
    // totalDeduction is both (what left the wallets).
    const sums = {
      count: { $sum: 1 },
      totalAmount: { $sum: payoutService.AMOUNT_EXPR },
      totalFees: { $sum: payoutService.FEE_EXPR },
      totalDeduction: { $sum: "$totalAmount" },
    };
    const match = { $match: { ...payoutService.WITHDRAWAL, createdAt: { $gte: start, $lte: end } } };
    const rounded = ({ count, totalAmount, totalFees, totalDeduction, ...rest }) => ({
      ...rest,
      count,
      totalAmount: money.round(totalAmount),
      totalFees: money.round(totalFees),
      totalDeduction: money.round(totalDeduction),
    });

    const [stats, totalStats] = await Promise.all([
      Transaction.aggregate([match, { $group: { _id: "$status", ...sums } }]),
      Transaction.aggregate([match, { $group: { _id: null, ...sums } }]),
    ]);
    const { _id, count, ...totals } = totalStats[0] ? rounded(totalStats[0]) : { count: 0, totalAmount: 0, totalFees: 0, totalDeduction: 0 };

    res.json({
      success: true,
      data: {
        period: { startDate: start, endDate: end },
        statusBreakdown: stats.map(rounded),
        totals: { totalCount: count, ...totals },
      },
    });
  } catch (error) {
    throw new Error(error.message || "Failed to get withdrawal statistics");
  }
});

module.exports = {
  processWithdrawal,
  getPendingWithdrawals,
  getWithdrawalStats,
};
