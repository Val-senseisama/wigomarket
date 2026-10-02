/**
 * @file storeEarningsPipeline.js
 * @description Aggregation stages that turn orders into one store's earnings.
 *              Shared by the Earnings & Transactions screen
 *              (controllers/store/getStoreEarnings) and the dashboard's Recent
 *              Earnings widget (controllers/store/getRecentEarnings), so the two
 *              can never show different amounts for the same order.
 *
 * Money: line amounts are integer kobo inside the aggregation; callers convert
 * to naira once via utils/money.
 */

const { PaymentStatus } = require("../utils/constants");

// Orders that were paid, whatever has been refunded from them since.
const PAID_PAYMENT_STATUSES = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

// A row's status is this store's own refund position, not the order's: in a
// multi-store order another seller's refund does not touch this one's earning.
const EARNING_STATUSES = {
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
};

/**
 * Vendor unit price for one unwound line: the price snapshotted on the order
 * when it was placed, else (older orders) the product's current price.
 */
const LINE_PRICE = {
  $ifNull: ["$products.price", { $ifNull: ["$productDoc.price", 0] }],
};

/** Integer kobo for one line item: unit price (naira) × quantity. */
const lineKobo = {
  $multiply: [
    { $round: [{ $multiply: [LINE_PRICE, 100] }, 0] },
    { $ifNull: ["$products.count", 0] },
  ],
};

/**
 * Stages that reduce each order to this store's share: one document per order
 * with its items, the kobo earned and when it was earned (payment time,
 * falling back to createdAt for orders paid before paid_at was recorded).
 */
const perOrderEarnings = (storeId) => [
  { $unwind: "$products" },
  { $match: { "products.store": storeId } },
  {
    $lookup: {
      from: "products",
      localField: "products.product",
      foreignField: "_id",
      pipeline: [{ $project: { title: 1, price: 1, images: { $slice: ["$images", 1] } } }],
      as: "productDoc",
    },
  },
  { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
  {
    $group: {
      _id: "$_id",
      orderNumber: { $first: "$orderNumber" },
      orderedBy: { $first: "$orderedBy" },
      paymentStatus: { $first: "$paymentStatus" },
      createdAt: { $first: "$createdAt" },
      earnedAt: { $first: { $ifNull: ["$paymentIntent.paid_at", "$createdAt"] } },
      earnedKobo: { $sum: lineKobo },
      items: {
        $push: {
          productId: "$products.product",
          title: "$productDoc.title",
          image: { $arrayElemAt: ["$productDoc.images", 0] },
          quantity: "$products.count",
          unitPrice: LINE_PRICE,
          kobo: lineKobo,
        },
      },
    },
  },
];

/**
 * Net each order's earning of this store's settled refunds (the seller's share
 * that went back to the buyer — see services/orderRefundService):
 *   grossKobo     what the order earned before refunds
 *   refundedKobo  taken back by settled refunds
 *   earnedKobo    the difference — what the store keeps
 *   earningStatus paid | partially_refunded | refunded
 */
const netOfRefunds = (storeId) => [
  {
    $lookup: {
      from: "refunds",
      let: { orderId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$order", "$$orderId"] },
            store: storeId,
            status: "settled",
          },
        },
        {
          $group: {
            _id: null,
            kobo: { $sum: { $round: [{ $multiply: ["$vendorAmount", 100] }, 0] } },
          },
        },
      ],
      as: "refunded",
    },
  },
  {
    $addFields: {
      grossKobo: "$earnedKobo",
      refundedKobo: { $ifNull: [{ $arrayElemAt: ["$refunded.kobo", 0] }, 0] },
    },
  },
  {
    $addFields: {
      earnedKobo: { $max: [0, { $subtract: ["$grossKobo", "$refundedKobo"] }] },
      earningStatus: {
        $switch: {
          branches: [
            { case: { $lte: ["$refundedKobo", 0] }, then: "paid" },
            { case: { $gte: ["$refundedKobo", "$grossKobo"] }, then: "refunded" },
          ],
          default: "partially_refunded",
        },
      },
    },
  },
  { $project: { refunded: 0 } },
];

module.exports = {
  PAID_PAYMENT_STATUSES,
  EARNING_STATUSES,
  LINE_PRICE,
  lineKobo,
  perOrderEarnings,
  netOfRefunds,
};
