const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const Store = require("../../models/storeModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const Order = require("../../models/orderModel");
const Transaction = require("../../models/transactionModel");
const money = require("../../utils/money");
const { WITHDRAWAL, AMOUNT_EXPR } = require("../../services/withdrawalPayoutService");

/**
 * @function getOverview
 * @description Aggregated counts for the admin dashboard home screen.
 * @access Admin only
 */
const getOverview = asyncHandler(async (req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [
    usersByStatus,
    usersByRole,
    dispatchByStatus,
    storesByStatus,
    ordersByStatus,
    ordersToday,
    pendingWithdrawals,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    User.aggregate([
      { $unwind: "$role" },
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]),
    DispatchProfile.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Store.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Order.aggregate([{ $group: { _id: "$orderStatus", count: { $sum: 1 } } }]),
    Order.countDocuments({ createdAt: { $gte: startOfDay } }),
    // Unsettled withdrawals, split into those awaiting a decision and those
    // whose payout is in transit. Amounts are what the banks will receive.
    Transaction.aggregate([
      { $match: { ...WITHDRAWAL, status: "pending" } },
      {
        $group: {
          _id: { $eq: ["$payout.status", "in_transit"] },
          count: { $sum: 1 },
          totalAmount: { $sum: AMOUNT_EXPR },
        },
      },
    ]),
  ]);

  const awaiting = pendingWithdrawals.find((g) => g._id === false);
  const inTransit = pendingWithdrawals.find((g) => g._id === true);

  res.json({
    success: true,
    data: {
      users: { byStatus: usersByStatus, byRole: usersByRole },
      dispatchProfiles: { byStatus: dispatchByStatus },
      stores: { byStatus: storesByStatus },
      orders: { byStatus: ordersByStatus, today: ordersToday },
      withdrawals: {
        pending: awaiting?.count || 0,
        pendingAmount: money.round(awaiting?.totalAmount || 0),
        inTransit: inTransit?.count || 0,
        inTransitAmount: money.round(inTransit?.totalAmount || 0),
      },
    },
  });
});

module.exports = getOverview;
