const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const { fromKobo } = require("../../utils/money");
const { formatOrderNumber } = require("../../utils/orderSerializer");
const {
  PAID_PAYMENT_STATUSES,
  perOrderEarnings,
  netOfRefunds,
} = require("../../services/storeEarningsPipeline");

/**
 * @function getRecentEarnings
 * @description The seller dashboard's "Recent Earnings" widget: the store's
 *              latest few sales, newest first. A lightweight sibling of
 *              GET /api/store/earnings — no summary cards, search, filters,
 *              customer lookup or total count — built on the same per-order
 *              earning stages, so an order shows the same amount in both.
 *
 * @access Seller only (isSeller sets req.store)
 *
 * Query params:
 *   limit — how many entries (default 5, max 20)
 *
 * `amount` is what the store keeps: its share at vendor price, less any settled
 * refunds. Entries are ordered by when the payment was received.
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

// The widget's badge wording ("Successful") differs from the earnings table's
// ("Paid"); the `status` token is the same in both.
const STATUS_LABELS = {
  paid: "Successful",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
};

const getRecentEarnings = asyncHandler(async (req, res) => {
  if (!req.store) {
    return res.status(404).json({
      success: false,
      message: "No store found for this account",
    });
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
  const storeId = new mongoose.Types.ObjectId(req.store);

  const rows = await Order.aggregate([
    { $match: { "products.store": storeId, paymentStatus: { $in: PAID_PAYMENT_STATUSES } } },
    // Pick the newest orders first, so the product and refund lookups below
    // only ever run for `limit` orders however many the store has.
    { $addFields: { recentAt: { $ifNull: ["$paymentIntent.paid_at", "$createdAt"] } } },
    { $sort: { recentAt: -1, _id: -1 } },
    { $limit: limit },
    ...perOrderEarnings(storeId),
    ...netOfRefunds(storeId),
    { $sort: { earnedAt: -1, _id: -1 } },
  ]);

  res.json({
    success: true,
    data: {
      currency: "NGN",
      earnings: rows.map((row) => ({
        id: row._id,
        orderNumber: formatOrderNumber(row),
        type: "sale",
        title: "Sales",
        amount: fromKobo(Math.round(row.earnedKobo || 0)),
        grossAmount: fromKobo(Math.round(row.grossKobo || 0)),
        refundedAmount: fromKobo(Math.round(row.refundedKobo || 0)),
        currency: "NGN",
        earnedAt: row.earnedAt,
        status: row.earningStatus,
        statusLabel: STATUS_LABELS[row.earningStatus] ?? row.earningStatus,
      })),
    },
  });
});

module.exports = getRecentEarnings;
