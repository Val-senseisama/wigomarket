const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const Store = require("../../models/storeModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const Order = require("../../models/orderModel");
const Transaction = require("../../models/transactionModel");

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
    Transaction.aggregate([
      { $match: { type: "wallet_withdrawal", status: "pending" } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmount: { $sum: "$totalAmount" },
        },
      },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      users: { byStatus: usersByStatus, byRole: usersByRole },
      dispatchProfiles: { byStatus: dispatchByStatus },
      stores: { byStatus: storesByStatus },
      orders: { byStatus: ordersByStatus, today: ordersToday },
      withdrawals: {
        pending: pendingWithdrawals[0]?.count || 0,
        pendingAmount: pendingWithdrawals[0]?.totalAmount || 0,
      },
    },
  });
});

module.exports = getOverview;
