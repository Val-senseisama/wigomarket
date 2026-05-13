const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");
const { DateTime } = require("luxon");

/**
 * @function getEarningsOverview
 * @description Get earnings overview (today, this week, total, pending)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getEarningsOverview = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const userObjectId = new mongoose.Types.ObjectId(_id);

  const wallet = await Wallet.findOne({ user: _id });
  if (!wallet) {
    return res.status(404).json({ success: false, message: "Wallet not found" });
  }

  // Use Lagos time as a consistent base for "Today" and "This Week"
  const now = DateTime.now().setZone("Africa/Lagos");
  const startOfToday = now.startOf("day").toJSDate();
  const startOfWeek = now.startOf("week").toJSDate();

  // Base query for successful earnings (credits to the user's wallet)
  // We include any transaction where the user received a credit and status is completed.
  // We filter types to avoid counting deposits or transfers as "earnings"
  const earningsMatch = {
    "entries.userId": userObjectId,
    "entries.credit": { $gt: 0 },
    status: "completed",
    type: { $in: ["vendor_commission", "dispatch_commission", "order_payment", "platform_commission"] }
  };

  // Helper for aggregation
  const getAggregatedEarnings = async (startDate) => {
    const result = await Transaction.aggregate([
      { 
        $match: { 
          ...earningsMatch, 
          createdAt: { $gte: startDate } 
        } 
      },
      { $unwind: "$entries" },
      { 
        $match: { 
          "entries.userId": userObjectId, 
          "entries.credit": { $gt: 0 } 
        } 
      },
      { $group: { _id: null, total: { $sum: "$entries.credit" } } }
    ]);
    return result[0]?.total || 0;
  };

  const todayEarnings = await getAggregatedEarnings(startOfToday);
  const weekEarnings = await getAggregatedEarnings(startOfWeek);

  // Pending payouts (pending withdrawals)
  const pendingPayouts = await Transaction.aggregate([
    { 
      $match: { 
        "entries.userId": userObjectId,
        type: "wallet_withdrawal",
        status: "pending"
      } 
    },
    { $group: { _id: null, total: { $sum: "$totalAmount" } } }
  ]);

  res.json({
    success: true,
    data: {
      today: todayEarnings,
      thisWeek: weekEarnings,
      total: wallet.metadata.totalEarnings || 0,
      pending: pendingPayouts[0]?.total || 0,
      currentBalance: wallet.balance
    }
  });
});

module.exports = getEarningsOverview;
