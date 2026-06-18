const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const { DateTime } = require("luxon");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");

/**
 * @function getEarningsOverview
 * @description The four headline figures shown on the rider earnings screen:
 *                • today        — delivery fees earned since midnight (Lagos)
 *                • thisWeek     — delivery fees earned since the start of the week
 *                • pendingPayout— withdrawal requests still being processed
 *                • totalEarnings— lifetime delivery earnings
 *              Also returns the currently withdrawable wallet balance.
 *
 * @param {string} req.user._id - Authenticated agent's ID
 * @returns {Object} - { today, thisWeek, pendingPayout, totalEarnings, availableBalance }
 */
const getEarningsOverview = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can view earnings.",
    });
  }

  const agentId = new mongoose.Types.ObjectId(_id);

  // Lagos time anchors for "Today" and "This Week"
  const now = DateTime.now().setZone("Africa/Lagos");
  const startOfToday = now.startOf("day").toJSDate();
  const startOfWeek = now.startOf("week").toJSDate();

  const sumDeliveryFees = async (since) => {
    const result = await Order.aggregate([
      {
        $match: {
          deliveryAgent: agentId,
          deliveryStatus: "delivered",
          actualDeliveryTime: { $gte: since },
        },
      },
      { $group: { _id: null, total: { $sum: "$deliveryFee" } } },
    ]);
    return result[0]?.total || 0;
  };

  const [today, thisWeek, dispatchProfile, wallet, pendingPayoutAgg] =
    await Promise.all([
      sumDeliveryFees(startOfToday),
      sumDeliveryFees(startOfWeek),
      DispatchProfile.findOne({ user: _id }).select("earnings").lean(),
      Wallet.findOne({ user: _id }).select("balance metadata").lean(),
      Transaction.aggregate([
        {
          $match: {
            "entries.userId": agentId,
            type: "wallet_withdrawal",
            status: "pending",
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]),
    ]);

  res.json({
    success: true,
    data: {
      today,
      thisWeek,
      pendingPayout: pendingPayoutAgg[0]?.total || 0,
      totalEarnings: dispatchProfile?.earnings?.totalEarnings || 0,
      availableBalance: wallet?.balance || 0,
      totalDeliveries: dispatchProfile?.earnings?.totalDeliveries || 0,
    },
  });
});

module.exports = getEarningsOverview;
