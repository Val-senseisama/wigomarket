const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transactionModel");
const { WITHDRAWAL, amountsOf } = require("../../services/withdrawalPayoutService");

/**
 * @function getWithdrawalHistory
 * @description Get user's withdrawal history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Withdrawal history
 */
const getWithdrawalHistory = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [withdrawals, total] = await Promise.all([
    Transaction.find({ ...WITHDRAWAL, "entries.userId": _id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Transaction.countDocuments({ ...WITHDRAWAL, "entries.userId": _id }),
  ]);

  res.json({
    success: true,
    data: {
      // totalAmount on the row is amount + fee (what left the wallet);
      // amount is what the bank receives.
      withdrawals: withdrawals.map((w) => ({ ...w.toObject(), ...amountsOf(w) })),
      pagination: {
        currentPage: page,
        totalTransactions: total,
        hasMore: skip + withdrawals.length < total,
      },
    },
  });
});

module.exports = getWithdrawalHistory;
