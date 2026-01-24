const PaymentStatus = {
  PAID: "Paid",
  PENDING: "Pending",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  UNPAID: "Unpaid",
};

const OrderStatus = {
  PENDING: "Pending",
  NOT_PROCESSED: "Not yet processed",
  PROCESSING: "Processing",
  DISPATCHED: "Dispatched",
  CANCELLED: "Cancelled",
  DELIVERED: "Delivered",
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
