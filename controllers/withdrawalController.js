const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const { getFlutterwaveInstance } = require("../config/flutterwaveClient");
const { MakeID } = require("../Helpers/Helpers");
const audit = require("../services/auditService");

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

  // ── Step 1: Fetch transaction & wallet BEFORE opening a session ───────────
  const transaction = await Transaction.findOne({
    transactionId,
    type: "wallet_withdrawal",
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

  // ── Step 2: If approving, call FLW OUTSIDE any MongoDB session ───────────
  let transferResponse;
  if (action === "approve") {
    const flw = getFlutterwaveInstance();
    transferResponse = await flw.Transfer.initiate({
      account_bank: wallet.bankAccount.bankCode,
      account_number: wallet.bankAccount.accountNumber,
      amount: transaction.totalAmount,
      narration: `Withdrawal from WigoMarket wallet - ${transactionId}`,
      currency: "NGN",
      reference: `WD_${transactionId}`,
      callback_url: `${process.env.API_URL}/api/webhooks/transfer`,
      debit_currency: "NGN",
    });
    if (transferResponse.status !== "success") {
      audit.error({
        action: "wallet.withdrawal_api_failed",
        actor: audit.actor(req),
        resource: { type: "transaction", id: transactionId },
        metadata: {
          error: transferResponse.message,
          code: transferResponse.status,
        },
      });
      throw new Error(transferResponse.message || "Transfer initiation failed");
    }
  }

  // ── Step 3: All DB writes in one atomic session ───────────────────────────
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      // Re-fetch inside session to lock the document
      const txn = await Transaction.findOne({
        transactionId,
        type: "wallet_withdrawal",
        status: "pending",
      }).session(session);
      if (!txn)
        throw new Error("Withdrawal already processed by another request");

      const w = await Wallet.findOne({ user: walletUserId }).session(session);
      if (!w) throw new Error("User wallet not found");

      if (action === "approve") {
        txn.status = "completed";
        txn.audit.approvedBy = adminId;
        txn.audit.approvedAt = new Date();
        txn.metadata.externalTransactionId = transferResponse.data.reference;
        txn.metadata.notes =
          "Withdrawal approved and processed via Flutterwave";
        await txn.save({ session });

        result = {
          message: "Withdrawal approved and processed successfully",
          data: {
            transactionId: txn.transactionId,
            amount: txn.totalAmount,
            flwReference: transferResponse.data.reference,
            status: "completed",
          },
        };
      } else {
        // Reject — refund the deducted amount back to wallet
        const withdrawalFee =
          txn.entries.find((e) => e.account === "bank_transfer_fees")?.debit ||
          0;
        const refundAmount = txn.totalAmount + withdrawalFee;

        await w.addFunds(refundAmount, "refund", session);

        const reversalTransactionId = `REV_${Date.now()}_${MakeID(16)}`;
        await Transaction.createTransaction(
          {
            transactionId: reversalTransactionId,
            reference: `Reversal-${transactionId}`,
            type: "wallet_deposit",
            totalAmount: refundAmount,
            entries: [
              {
                account: "wallet_vendor",
                userId: w.user,
                debit: 0,
                credit: refundAmount,
                description: `Refund for rejected withdrawal ${transactionId}`,
              },
              {
                account: "cash_account",
                userId: w.user,
                debit: refundAmount,
                credit: 0,
                description: "Refund payment",
              },
            ],
            relatedEntity: { type: "withdrawal", id: txn._id },
            status: "completed",
            metadata: {
              paymentMethod: "refund",
              notes: `Refund for rejected withdrawal: ${reason || "No reason provided"}`,
              originalTransactionId: transactionId,
            },
          },
          session,
        );

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
      }
    });
  } finally {
    await session.endSession();
  }

  audit.log({
    action:
      action === "approve"
        ? "wallet.withdrawal_approved"
        : "wallet.withdrawal_rejected",
    actor: audit.actor(req),
    resource: { type: "transaction", id: transactionId },
    changes: {
      after: {
        action,
        reason: reason || null,
        status: action === "approve" ? "completed" : "cancelled",
      },
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

  const query = { type: "wallet_withdrawal", status: "pending" };

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
    const fee =
      w.entries.find((e) => e.account === "bank_transfer_fees")?.debit || 0;
    return {
      transactionId: w.transactionId,
      reference: w.reference,
      user,
      amount: w.totalAmount,
      fee,
      totalDeduction: w.totalAmount + fee,
      createdAt: w.createdAt,
      metadata: w.metadata,
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

    const stats = await Transaction.aggregate([
      {
        $match: {
          type: "wallet_withdrawal",
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
        },
      },
    ]);

    const totalStats = await Transaction.aggregate([
      {
        $match: {
          type: "wallet_withdrawal",
          createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
          // $filter selects fee entries, then $sum adds their debit values
          totalFees: {
            $sum: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: "$entries",
                      as: "entry",
                      cond: { $eq: ["$$entry.account", "bank_transfer_fees"] },
                    },
                  },
                  as: "feeEntry",
                  in: "$$feeEntry.debit",
                },
              },
            },
          },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        period: { startDate: start, endDate: end },
        statusBreakdown: stats,
        totals: totalStats[0] || {
          totalCount: 0,
          totalAmount: 0,
          totalFees: 0,
        },
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
