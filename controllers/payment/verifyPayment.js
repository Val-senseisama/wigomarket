const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { PaymentStatus } = require("../../utils/constants");
const audit = require("../../services/auditService");
const { settleOrderPayment, findOrderCharge, SettlementError } = require("../../services/orderPaymentSettlement");

/**
 * @function verifyPayment
 * @description Check an order's checkout with its payment provider and, if the
 * provider confirms the charge, book it (the client calls this on return from
 * checkout).
 *
 * DESIGN:
 *   1. Ask the provider about the order's own checkout references — never an
 *      id the client sends — outside any MongoDB session.
 *   2. Book a succeeded charge through services/orderPaymentSettlement, which
 *      is shared with the webhook and the cron and books each charge once.
 *
 * `transaction_id` in the body is accepted for older clients and ignored.
 */
const verifyPayment = asyncHandler(async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required",
    });
  }

  validateMongodbId(orderId);

  const order = await Order.findById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  // The response carries the whole order (buyer details, address), so only
  // its buyer — or an admin in their admin role — may verify it.
  const isOwner = String(order.orderedBy) === String(req.user._id);
  if (!isOwner && req.user.activeRole !== "admin") {
    return res.status(403).json({ success: false, message: "You are not authorized to verify this order" });
  }

  if (order.paymentStatus === PaymentStatus.PAID) {
    return res.status(200).json({
      success: true,
      message: "Payment already processed",
      data: { order, ledger: { transactionId: order.paymentIntent?.transaction_id, reference: `Payment-${orderId}` } },
    });
  }

  // ── Step 1: Ask the provider, OUTSIDE any session ─────────────────────────
  const found = await findOrderCharge(order);
  if (!found) {
    return res.status(400).json({
      success: false,
      message: "Payment has not been started for this order",
    });
  }
  const { provider, charge } = found;

  if (charge.status !== "succeeded") {
    if (charge.status === "failed") {
      await Order.updateOne(
        { _id: orderId, paymentStatus: { $ne: PaymentStatus.PAID } },
        { $set: { "paymentIntent.status": "failed", "paymentIntent.failed_at": new Date() } },
      );
    }

    audit.error({
      action: "payment.verification_failed",
      actor: audit.actor(req),
      resource: { type: "order", id: orderId },
      metadata: { provider, status: charge.status, providerStatus: charge.providerStatus, reference: charge.reference },
    });

    return res.status(400).json({
      success: false,
      message: charge.status === "pending" ? "Payment is not complete yet" : "Payment verification failed",
      data: { status: charge.status, providerStatus: charge.providerStatus },
    });
  }

  // ── Step 2: Book it (exactly once across verify / webhook / cron) ──────────
  let settled;
  try {
    settled = await settleOrderPayment({ orderId, provider, charge, source: "verify", actor: audit.actor(req) });
  } catch (err) {
    if (err instanceof SettlementError) {
      return res.status(409).json({
        success: false,
        message: "Payment was received but could not be matched to this order. Support has been notified.",
      });
    }
    throw err;
  }

  res.json({
    success: true,
    message: settled.result === "settled" ? "Payment verified and processed successfully" : "Payment already processed",
    data: {
      order: settled.order,
      payment: {
        provider,
        transaction_id: charge.providerTransactionId,
        reference: charge.reference,
        amount: charge.amount,
        currency: charge.currency,
        status: charge.status,
        paid_at: settled.order?.paymentIntent?.paid_at ?? new Date(),
      },
      ...(settled.commission && { commission: settled.commission }),
      ...(settled.vat && { vat: settled.vat }),
      ledger: settled.transaction && {
        transactionId: settled.transaction.transactionId,
        reference: settled.transaction.reference,
      },
    },
  });
});

module.exports = verifyPayment;
