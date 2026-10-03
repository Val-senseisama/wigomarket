/**
 * @file webhookController.js
 * @description Payment provider webhook receiver: POST /api/payment/webhook/:provider
 * (and the legacy POST /api/payment/webhook, which is Flutterwave's).
 *
 * DESIGN:
 *   1. Check the provider's signature over the raw body. Reject on failure.
 *   2. Respond HTTP 200 right away — providers expect a fast acknowledgement
 *      and retry if they don't get one in time.
 *   3. Hand the parsed event to the payment queue (BullMQ when Redis is
 *      available, or a setImmediate fallback when it is not). The processor
 *      re-verifies the charge with the provider before booking anything.
 *
 * The processing logic lives in services/webhookPaymentProcessor.js.
 */

const asyncHandler = require("express-async-handler");
const payments = require("../services/payments");
const audit = require("../services/auditService");
const { enqueueWebhookPayment } = require("../services/paymentQueue");

const handlePaymentWebhook = asyncHandler(async (req, res) => {
  const providerName = String(req.params.provider || "flutterwave").toLowerCase();
  if (!payments.isProvider(providerName)) {
    return res.status(404).json({ success: false, message: "Unknown payment provider" });
  }
  const provider = payments.getProvider(providerName);

  const signatureValid = provider.verifyWebhookSignature({ headers: req.headers, rawBody: req.rawBody });
  if (!signatureValid) {
    audit.error({
      action: "webhook.invalid_signature",
      actor: { userId: null, role: "system", ip: req.ip },
      metadata: { provider: providerName, event: req.body?.event ?? req.body?.eventType },
    });
    return res.status(401).json({ success: false, message: "Invalid signature" });
  }

  // ── Acknowledge immediately ────────────────────────────────────────────────
  res.status(200).json({ success: true, message: "Webhook received" });

  const event = provider.parseWebhook(req.body);
  if (!event) return; // an event type we don't act on

  // ── Enqueue for async processing ───────────────────────────────────────────
  enqueueWebhookPayment(providerName, event, req.ip).catch((err) => {
    console.error("[Webhook] Enqueue error:", err.message);
  });
});

module.exports = { handlePaymentWebhook };
