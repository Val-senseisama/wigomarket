const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Order = require("../../models/orderModel");
const payments = require("../../services/payments");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { PaymentStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");

/**
 * @function initializePayment
 * @description Start a hosted checkout with the active payment provider.
 *
 * Each call opens a fresh checkout under a new reference
 * (`<paymentIntent.id>-<random>`): providers refuse to reuse a reference, and
 * a buyer who closed the tab must be able to try again. Every reference is
 * kept on `paymentIntent.references` *before* the provider is called, so a
 * webhook for any of them still finds the order.
 *
 * @param {string} req.body.orderId - Order ID to pay for
 * @returns {Object} - { payment_url, reference, provider, orderId, amount }
 */
const initializePayment = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  const { _id } = req.user;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  validateMongodbId(orderId);

  const order = await Order.findById(orderId).populate("orderedBy", "fullName email mobile");

  if (!order) {
    return res.status(404).json({
      success: false,
      message: "Order not found",
    });
  }

  // Check if order belongs to user
  if (order.orderedBy._id.toString() !== _id.toString()) {
    return res.status(403).json({
      success: false,
      message: "Access denied. This order doesn't belong to you.",
    });
  }

  // Check if order is already paid
  if (order.paymentStatus === PaymentStatus.PAID) {
    return res.status(400).json({
      success: false,
      message: "Order is already paid",
    });
  }

  const provider = payments.getProvider();
  const user = order.orderedBy;
  const totalAmount = order.paymentIntent.amount;
  const reference = `${order.paymentIntent.id}-${crypto.randomBytes(4).toString("hex")}`;

  // Record the reference first: if we crash after the provider call, the
  // webhook and the cron can still tie the charge to this order.
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        "paymentIntent.provider": provider.name,
        "paymentIntent.reference": reference,
        "paymentIntent.initializedAt": new Date(),
        "paymentIntent.status": PaymentStatus.PENDING,
      },
      $push: { "paymentIntent.references": reference },
    },
  );

  let checkout;
  try {
    checkout = await provider.initializeCheckout({
      reference,
      amount: totalAmount,
      currency: order.paymentIntent.currency || "NGN",
      customer: {
        email: user.email,
        phone: user.mobile,
        name: user.fullName || "Customer",
      },
      description: `Payment for Order #${order.orderNumber ?? order.paymentIntent.id}`,
      redirectUrl: `${process.env.FRONTEND_URL}/payment/callback?orderId=${orderId}`,
      metadata: { orderId: String(orderId), userId: String(_id) },
    });
  } catch (err) {
    audit.error({
      action: "payment.initialize_failed",
      actor: audit.actor(req),
      resource: { type: "order", id: orderId },
      metadata: { provider: provider.name, reference, error: err.message },
    });
    return res.status(502).json({
      success: false,
      message: "Could not start payment. Please try again.",
    });
  }

  if (checkout.providerReference) {
    await Order.updateOne({ _id: orderId }, { $set: { "paymentIntent.providerReference": checkout.providerReference } });
  }

  audit.log({
    action: "payment.initialized",
    actor: audit.actor(req),
    resource: { type: "order", id: orderId },
    changes: { after: { amount: totalAmount, provider: provider.name, reference, paymentStatus: "Pending" } },
  });

  res.json({
    success: true,
    message: "Payment initialized successfully",
    data: {
      payment_url: checkout.checkoutUrl,
      reference,
      provider: provider.name,
      orderId: orderId,
      amount: totalAmount,
    },
  });
});

module.exports = initializePayment;
