/**
 * @file orderContactService.js
 * @description Single chokepoint for the "Contact Customer" feature: lets a
 *   seller (or admin) send a free-text message directly to the buyer who placed
 *   an order. The message is persisted as an in-app notification and pushed out
 *   over the buyer's enabled channels (push + email) via the notification
 *   service. The action is audited.
 *
 *   Scoping is enforced by the caller via `scopeFilter` (e.g. a seller passes
 *   `{ "products.store": req.store }` so they can only message their own
 *   customers); admins pass `{}`.
 */

const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Notification = require("../models/notificationModel");
const firebaseService = require("./firebaseNotificationService");
const audit = require("./auditService");

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Error type carrying an HTTP status code so controllers can map cleanly.
 */
class OrderContactError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OrderContactError";
    this.statusCode = statusCode;
  }
}

function buyerName(buyer) {
  if (!buyer) return "Customer";
  if (buyer.fullName) return buyer.fullName;
  const parts = [buyer.firstname, buyer.lastname].filter(Boolean);
  return parts.length ? parts.join(" ") : "Customer";
}

/**
 * Send a direct message to the buyer of an order.
 *
 * @param {Object}  params
 * @param {string}  params.orderId      - Order whose buyer should be contacted
 * @param {string}  params.message      - Free-text message body
 * @param {Object}  [params.scopeFilter] - Extra Mongo filter for access control
 * @param {string}  [params.senderName] - Display name shown to the buyer (store name / "WigoMarket")
 * @param {Object}  params.req          - Express request (for sender id + audit actor)
 * @returns {Object} delivery summary
 * @throws {OrderContactError}
 */
async function contactCustomer({ orderId, message, scopeFilter = {}, senderName, req }) {
  if (!mongoose.isValidObjectId(orderId)) {
    throw new OrderContactError("Invalid order id", 400);
  }

  const trimmed = typeof message === "string" ? message.trim() : "";
  if (!trimmed) {
    throw new OrderContactError("Message is required", 400);
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new OrderContactError(
      `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
      400,
    );
  }

  const order = await Order.findOne({ _id: orderId, ...scopeFilter })
    .populate("orderedBy", "fullName firstname lastname email mobile")
    .select("orderNumber orderedBy");

  if (!order) {
    // Caller decides whether this is 404 (admin) or 403 (out-of-scope seller);
    // we surface it as not-found and let the controller phrase the message.
    throw new OrderContactError("Order not found", 404);
  }

  const buyer = order.orderedBy;
  if (!buyer || !buyer._id) {
    throw new OrderContactError("This order has no associated customer", 422);
  }

  const orderNumber = order.orderNumber ? `#${order.orderNumber}` : "your order";
  const from = senderName || "WigoMarket";
  const title = `Message from ${from} about ${orderNumber}`;

  const data = {
    orderId: String(order._id),
    ...(order.orderNumber && { orderNumber: order.orderNumber }),
    kind: "customer_message",
  };

  // Persist the in-app notification (also enable email delivery).
  const notification = await Notification.createNotification({
    recipient: buyer._id,
    sender: req.user?._id,
    type: "customer_message",
    title,
    message: trimmed,
    data,
    role: "buyer",
    priority: "high",
    relatedEntity: { type: "order", id: order._id },
    channels: {
      inApp: { enabled: true },
      email: { enabled: true },
    },
  });

  // Fire push + email out-of-band; never let a delivery failure fail the request.
  try {
    await firebaseService.sendNotificationToUser(
      String(buyer._id),
      title,
      trimmed,
      data,
      "orderUpdates",
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("contactCustomer: push/email delivery failed:", err.message);
  }

  audit.log({
    action: "order.customer_contacted",
    actor: audit.actor(req),
    resource: {
      type: "order",
      id: order._id,
      displayName: orderNumber,
    },
    metadata: {
      recipientId: String(buyer._id),
      notificationId: String(notification._id),
      messageLength: trimmed.length,
    },
  });

  return {
    notificationId: notification._id,
    orderId: order._id,
    orderNumber: order.orderNumber || null,
    recipient: {
      id: buyer._id,
      name: buyerName(buyer),
      email: buyer.email || null,
      mobile: buyer.mobile || null,
    },
    message: trimmed,
    sentAt: notification.createdAt,
  };
}

module.exports = { contactCustomer, OrderContactError, MAX_MESSAGE_LENGTH };
