const { PaymentStatus } = require("./constants");

/**
 * Which orders a seller sees in their order lists (GET /api/store/orders,
 * /api/store/orders/recent) and live feed (/ws/orders).
 *
 * A card/bank order is created before the buyer pays, and many such checkouts
 * are abandoned. Showing them would have sellers preparing orders nobody paid
 * for, so a card/bank order appears only once its payment has gone through
 * (including ones since refunded). Cash orders are paid on delivery, so they
 * appear as soon as they are placed.
 */
const PAID_STATUSES = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** Mongo filter fragment: orders visible to sellers. */
const SELLER_VISIBLE_FILTER = {
  $or: [{ paymentMethod: "cash" }, { paymentStatus: { $in: PAID_STATUSES } }],
};

/** The same rule for an order already in memory. */
const isVisibleToSeller = (order) =>
  order.paymentMethod === "cash" || PAID_STATUSES.includes(order.paymentStatus);

module.exports = { SELLER_VISIBLE_FILTER, isVisibleToSeller };
