const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");

/**
 * @function getWalletStats
 * @description Get wallet statistics and analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Wallet statistics
 */
const getWalletStats = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  const wallet = await Wallet.getWalletByUser(_id);

  if (!wallet) {
    return res.status(404).json({ success: false, message: "Wallet not found" });
  }

  // countDocuments — no documents fetched, just a count
  const transactionCount = await Transaction.countDocuments({
    "entries.userId": _id,
    status: "completed",
  });

  res.json({
    success: true,
    data: {
      currentBalance: wallet.balance,
      totalEarnings: wallet.metadata.totalEarnings,
      totalWithdrawals: wallet.metadata.totalWithdrawals,
      totalCommissions: wallet.metadata.totalCommissions,
      totalVATCollected: wallet.metadata.totalVATCollected,
      withdrawalLimits: {
        daily: wallet.limits.dailyWithdrawal,
        monthly: wallet.limits.monthlyWithdrawal,
        dailyUsed: wallet.withdrawalStats.dailyWithdrawn.amount,
        monthlyUsed: wallet.withdrawalStats.monthlyWithdrawn.amount,
      },
      transactionCount,
      lastTransactionAt: wallet.metadata.lastTransactionAt,
      canWithdraw: wallet.canWithdraw,
    },
  });
});

module.exports = getWalletStats;
