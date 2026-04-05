const asyncHandler = require("express-async-handler");
const Transaction = require("../../models/transactionModel");

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
    Transaction.find({ "entries.userId": _id, type: "wallet_withdrawal" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Transaction.countDocuments({ "entries.userId": _id, type: "wallet_withdrawal" }),
  ]);

  res.json({
    success: true,
    data: {
      withdrawals,
      pagination: {
        currentPage: page,
        totalTransactions: total,
        hasMore: skip + withdrawals.length < total,
      },
    },
  });
});

module.exports = getWithdrawalHistory;
