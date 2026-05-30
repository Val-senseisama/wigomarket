const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const redisClient = require("../../config/redisClient");

const TTL = 30; // 30 seconds — this is live operational data

/**
 * @function getActiveDeliveries
 * @description Returns the dispatch agent's current active deliveries:
 *              orders with deliveryStatus of "assigned", "picked_up", or "in_transit".
 *
 *   Cached for 30 seconds. Cache is automatically expired; it is also
 *   cleared by updateDeliveryStatus so the agent sees fresh data immediately
 *   after a status change.
 *
 * @route GET /api/delivery-agent/orders/active
 */
const getActiveDeliveries = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const cacheKey = `dispatch:active:${_id}`;

  // ── Cache read ─────────────────────────────────────────────────────────────
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  // ── DB query ───────────────────────────────────────────────────────────────
  const orders = await Order.find({
    deliveryAgent: _id,
    deliveryStatus: { $in: ["assigned", "picked_up", "in_transit"] },
  })
    .populate("orderedBy",        "firstname lastname mobile")
    .populate("products.product", "title images listedPrice brand")
    .populate("products.store",   "name address mobile")
    .sort({ updatedAt: -1 })
    .lean();

  const payload = {
    success: true,
    data: {
      count:  orders.length,
      orders,
    },
  };

  // ── Cache write ────────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch (_) {}

  res.json(payload);
});

module.exports = getActiveDeliveries;
