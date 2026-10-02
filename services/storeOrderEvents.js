/**
 * @file storeOrderEvents.js
 * @description Live order events for sellers' dashboards (the /ws/orders feed,
 *              websocket/storeOrdersWebSocket.js).
 *
 * Whenever an order is placed, paid or changes status, every store in it gets
 * an event carrying that store's Recent Orders row — the exact shape
 * GET /api/store/orders/recent returns — so the client can upsert the row by
 * id without refetching.
 *
 * Orders hidden from sellers (unpaid card/bank checkouts, see
 * utils/sellerOrderVisibility) produce no events. Such an order first reaches
 * sellers when its payment is confirmed, so the payment paths announce it as
 * order.created.
 *
 *   { type: "order.created" | "order.updated", storeId, order: <row>, at }
 *
 * Fan-out goes through Redis pub/sub, so a seller connected to one server
 * instance hears about an order placed through another. If Redis is not
 * connected, events are delivered to this instance's own sockets only, rather
 * than queued in ioredis's offline buffer and replayed late.
 *
 * Fire-and-forget by design: publishing never throws and is never awaited on a
 * request's critical path. A missed event costs a stale widget until the next
 * fetch, never a failed order or payment.
 */

const Order = require("../models/orderModel");
const redisClient = require("../config/redisClient");
const { serializeStoreOrderRow } = require("../utils/orderSerializer");
const { isVisibleToSeller } = require("../utils/sellerOrderVisibility");

const CHANNEL = "store_order_events";

const EVENT = {
  CREATED: "order.created",
  UPDATED: "order.updated",
};

// In-process subscribers (the WebSocket server on this instance).
const localListeners = new Set();

/** Register a handler for events delivered without Redis. Returns an unsubscribe fn. */
function onLocalEvent(handler) {
  localListeners.add(handler);
  return () => localListeners.delete(handler);
}

function deliverLocally(event) {
  for (const handler of localListeners) {
    try {
      handler(event);
    } catch (err) {
      console.error("[StoreOrderEvents] local handler failed:", err.message);
    }
  }
}

/** Build one event per store in the order. */
async function buildEvents(orderId, type) {
  const order = await Order.findById(orderId)
    .populate("orderedBy", "fullName firstname lastname")
    .populate("products.product", "listedPrice price store")
    .lean();
  // Not on sellers' screens yet (an unpaid card checkout): nothing to announce.
  if (!order || !isVisibleToSeller(order)) return [];

  const storeIds = [
    ...new Set(
      (order.products || [])
        .map((line) => line.store ?? line.product?.store)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const at = new Date().toISOString();
  return storeIds.map((storeId) => ({
    type,
    storeId,
    order: serializeStoreOrderRow(order, storeId),
    at,
  }));
}

async function publish(orderId, type) {
  const events = await buildEvents(orderId, type);
  for (const event of events) {
    if (redisClient.status === "ready") {
      await redisClient.publish(CHANNEL, JSON.stringify(event));
    } else {
      deliverLocally(event);
    }
  }
  return events;
}

/**
 * Announce an order change to the sellers involved. Returns immediately; the
 * returned promise (resolving to the events sent) exists for tests and never
 * rejects.
 *
 * @param {Object|string} orderId
 * @param {"order.created"|"order.updated"} [type]
 */
function publishStoreOrderEvent(orderId, type = EVENT.UPDATED) {
  return publish(orderId, type).catch((err) => {
    console.error(`[StoreOrderEvents] publish for order ${orderId} failed:`, err.message);
    return [];
  });
}

module.exports = {
  CHANNEL,
  EVENT,
  publishStoreOrderEvent,
  onLocalEvent,
  deliverLocally,
};
