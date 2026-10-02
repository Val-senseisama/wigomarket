const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const { serializeStoreOrderRow } = require("../../utils/orderSerializer");
const { SELLER_VISIBLE_FILTER } = require("../../utils/sellerOrderVisibility");

/**
 * @function getRecentOrders
 * @description The seller dashboard's "Recent Orders" widget: the store's
 *              newest orders, newest first. A lightweight sibling of
 *              GET /api/store/orders — no filters, search, tab counts or
 *              allowedActions — for the card that links to "View all".
 *
 *              Stays current without polling via the /ws/orders feed, whose
 *              events carry rows in exactly this shape (see
 *              services/storeOrderEvents).
 *
 * @access Seller only (isSeller sets req.store)
 *
 * Query params:
 *   limit — how many orders (default 5, max 20)
 *
 * `items` and `amount` cover this store's lines only: what the customer paid
 * for this seller's items, excluding other sellers' items and the delivery fee.
 * Unpaid card/bank checkouts are hidden until paid (utils/sellerOrderVisibility).
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

const getRecentOrders = asyncHandler(async (req, res) => {
  if (!req.store) {
    return res.status(404).json({
      success: false,
      message: "No store found for this account",
    });
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));

  const orders = await Order.find({ $and: [{ "products.store": req.store }, SELLER_VISIBLE_FILTER] })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .select("orderNumber products orderedBy orderStatus paymentStatus paymentMethod paymentIntent.currency createdAt")
    .populate("orderedBy", "fullName firstname lastname")
    // Only orders placed before line prices were snapshotted need this.
    .populate("products.product", "listedPrice price")
    .lean();

  res.json({
    success: true,
    data: {
      orders: orders.map((order) => serializeStoreOrderRow(order, req.store)),
      live: {
        path: "/ws/orders",
        events: ["order.created", "order.updated"],
      },
    },
  });
});

module.exports = getRecentOrders;
