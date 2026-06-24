const { DeliveryMethod } = require("./constants");
const { STATUS, normalizeStatus, statusLabel } = require("./orderStatus");
const { ORDER_NUMBER_PREFIX } = require("./generateOrderNumber");

/**
 * Display order number with a leading "#", e.g. "#WM1201".
 * Falls back to a short code derived from the Mongo _id for legacy orders
 * created before the orderNumber field existed.
 */
const formatOrderNumber = (order) => {
  if (order.orderNumber) return `#${order.orderNumber}`;
  const tail = order._id.toString().slice(-6).toUpperCase();
  return `#${ORDER_NUMBER_PREFIX}-${tail}`;
};

const deliveryTypeLabel = (deliveryMethod) =>
  deliveryMethod === DeliveryMethod.SELF_DELIVERY ? "Pick up" : "Delivery";

const itemsCount = (order) =>
  (order.products || []).reduce((sum, p) => sum + (p.count || 0), 0);

const customerName = (orderedBy) => {
  if (!orderedBy || typeof orderedBy !== "object") return null;
  if (orderedBy.fullName) return orderedBy.fullName;
  const parts = [orderedBy.firstname, orderedBy.lastname].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
};

/**
 * Flatten an order document into the row shape the dashboard table consumes.
 * The orderedBy ref must be populated (at least fullName/email/mobile) for the
 * customer column to be useful.
 */
const serializeOrderSummary = (order) => ({
  id: order._id,
  orderNumber: formatOrderNumber(order),
  orderDate: order.createdAt,
  customer: {
    id: order.orderedBy?._id || order.orderedBy || null,
    name: customerName(order.orderedBy),
    email: order.orderedBy?.email || null,
    mobile: order.orderedBy?.mobile || null,
  },
  itemsCount: itemsCount(order),
  amount: order.paymentIntent?.amount ?? 0,
  currency: order.paymentIntent?.currency || "NGN",
  deliveryType: deliveryTypeLabel(order.deliveryMethod),
  // Canonical lifecycle token (e.g. "pickUpReady") plus a display label.
  status: normalizeStatus(order.orderStatus),
  statusLabel: statusLabel(order.orderStatus),
  // Raw fields kept so the frontend can drive detail views / overrides.
  raw: {
    orderStatus: order.orderStatus,
    deliveryStatus: order.deliveryStatus,
    paymentStatus: order.paymentStatus,
    deliveryMethod: order.deliveryMethod,
  },
});

const firstImage = (images) => {
  const img = Array.isArray(images) ? images[0] : null;
  if (!img) return null;
  return typeof img === "string" ? img : img.url || img.secure_url || null;
};

// Unit price isn't persisted on the order line, so fall back to the product's
// current listedPrice (then price). Subtotal is unit × quantity.
const unitPrice = (product) =>
  product?.listedPrice ?? product?.price ?? 0;

const serializeLineItem = (line) => {
  const product = line.product && typeof line.product === "object" ? line.product : null;
  const unit = unitPrice(product);
  const quantity = line.count || 0;
  return {
    productId: product?._id || line.product || null,
    title: product?.title || "Unknown product",
    image: firstImage(product?.images),
    quantity,
    unitPrice: unit,
    subtotal: unit * quantity,
  };
};

// Ordered timeline steps. inTransit only applies to delivery_agent orders.
const TIMELINE_STEPS = [
  { status: STATUS.PENDING, label: "Order received" },
  { status: STATUS.CONFIRMED, label: "Order confirmed" },
  { status: STATUS.PREPARING, label: "Preparing for Delivery" },
  { status: STATUS.PICKUP_READY, label: "Ready for Pickup" },
  { status: STATUS.IN_TRANSIT, label: "Out for Delivery", deliveryMethodOnly: DeliveryMethod.DELIVERY_AGENT },
  { status: STATUS.DELIVERED, label: "Delivered" },
];

const PROGRESS_ORDER = [
  STATUS.PENDING,
  STATUS.CONFIRMED,
  STATUS.PREPARING,
  STATUS.PICKUP_READY,
  STATUS.IN_TRANSIT,
  STATUS.DELIVERED,
];

/**
 * Build the order timeline. A step is "completed" if the order has reached that
 * stage; timestamps come from statusHistory when available.
 */
const buildTimeline = (order) => {
  const history = order.statusHistory || [];
  const timeAt = (status) => {
    const entry = history.find((h) => h.status === status);
    if (entry) return entry.at;
    // Fallbacks for legacy orders without a recorded history.
    if (status === STATUS.PENDING) return order.createdAt;
    if (status === STATUS.DELIVERED) {
      return order.deliveryMetadata?.deliveredAt || order.actualDeliveryTime || null;
    }
    return null;
  };

  const current = normalizeStatus(order.orderStatus);
  const currentIdx = PROGRESS_ORDER.indexOf(current);
  const cancelled = current === STATUS.CANCELLED;

  const steps = TIMELINE_STEPS.filter(
    (s) => !s.deliveryMethodOnly || s.deliveryMethodOnly === order.deliveryMethod,
  ).map((s) => ({
    status: s.status,
    label: s.label,
    completed: !cancelled && currentIdx >= PROGRESS_ORDER.indexOf(s.status),
    at: timeAt(s.status),
  }));

  if (cancelled) {
    steps.push({
      status: STATUS.CANCELLED,
      label: "Cancelled",
      completed: true,
      at: timeAt(STATUS.CANCELLED),
    });
  }

  return steps;
};

// Seller payout for the order. Derived: released only once delivered & paid.
const derivePayoutStatus = (order) => {
  if (order.paymentStatus !== "Paid") return "Unpaid";
  return normalizeStatus(order.orderStatus) === STATUS.DELIVERED
    ? "Released"
    : "Awaiting";
};

/**
 * Full order detail for the order-details screen. Requires populated
 * products.product, orderedBy and deliveryAgent.
 */
const serializeOrderDetail = (order) => {
  const items = (order.products || []).map(serializeLineItem);
  const itemsTotal = items.reduce((sum, i) => sum + i.subtotal, 0);
  const deliveryFee = order.deliveryFee || 0;
  const rider =
    order.deliveryAgent && typeof order.deliveryAgent === "object"
      ? {
          id: order.deliveryAgent._id,
          name: customerName(order.deliveryAgent),
          mobile: order.deliveryAgent.mobile || null,
        }
      : null;

  return {
    id: order._id,
    orderNumber: formatOrderNumber(order),
    orderDate: order.createdAt,
    status: normalizeStatus(order.orderStatus),
    statusLabel: statusLabel(order.orderStatus),

    buyer: {
      id: order.orderedBy?._id || order.orderedBy || null,
      name: customerName(order.orderedBy),
      mobile: order.orderedBy?.mobile || null,
      email: order.orderedBy?.email || null,
    },

    delivery: {
      type: deliveryTypeLabel(order.deliveryMethod),
      method: order.deliveryMethod,
      address: order.deliveryAddress || order.deliveryLocation?.formattedAddress || null,
      preferredTime: null, // not currently captured at order time
      estimatedDeliveryTime: order.estimatedDeliveryTime || null,
      deliveryStatus: order.deliveryStatus,
      rider,
    },

    items,
    summary: {
      itemsTotal,
      deliveryFee,
      total: order.paymentIntent?.amount ?? itemsTotal + deliveryFee,
      currency: order.paymentIntent?.currency || "NGN",
    },

    payment: {
      method: order.paymentMethod || order.paymentIntent?.method || null,
      status: order.paymentStatus,
      transactionId: order.paymentIntent?.id || null,
      payoutStatus: derivePayoutStatus(order),
    },

    timeline: buildTimeline(order),
    buyerNote: order.deliveryNotes || null,
  };
};

module.exports = {
  serializeOrderSummary,
  serializeOrderDetail,
  formatOrderNumber,
};
