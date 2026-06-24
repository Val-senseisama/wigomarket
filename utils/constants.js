const PaymentStatus = {
  PAID: "Paid",
  PENDING: "Pending",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  UNPAID: "Unpaid",
};

// Canonical order lifecycle states. The transition rules, labels and legacy
// normalisation live in utils/orderStatus.js (the state machine). Keep these
// values in sync with STATUS there.
const OrderStatus = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  PREPARING: "preparing",
  PICKUP_READY: "pickUpReady",
  IN_TRANSIT: "inTransit",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
};

const DeliveryStatus = {
  PENDING_ASSIGNMENT: "pending_assignment",
  ASSIGNED: "assigned",
  PICKED_UP: "picked_up",
  IN_TRANSIT: "in_transit",
  DELIVERED: "delivered",
  FAILED: "failed",
};

const PaymentMethod = {
  CASH: "cash",
  CARD: "card",
  BANK: "bank",
  FLUTTERWAVE: "flutterwave",
};

const DeliveryMethod = {
  SELF_DELIVERY: "self_delivery",
  DELIVERY_AGENT: "delivery_agent",
};

module.exports = {
  PaymentStatus,
  OrderStatus,
  DeliveryStatus,
  PaymentMethod,
  DeliveryMethod,
};
