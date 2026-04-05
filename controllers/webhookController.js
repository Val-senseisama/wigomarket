/**
 * @file webhookController.js
 * @description Flutterwave webhook receiver.
 *
 * DESIGN:
 *   1. Verify the HMAC-SHA256 signature immediately. Reject on failure.
 *   2. Respond HTTP 200 right away — Flutterwave expects a fast acknowledgement
 *      and will retry if it doesn't receive one in time.
 *   3. Hand the payload off to the payment queue (BullMQ when Redis is available,
 *      or a setImmediate fallback when it is not). All DB work happens there.
 *
 * The actual payment processing logic lives in services/webhookPaymentProcessor.js.
 */

const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const appConfig = require("../config/appConfig");
const audit = require("../services/auditService");
const { enqueueWebhookPayment } = require("../services/paymentQueue");

const handleFlutterwaveWebhook = asyncHandler(async (req, res) => {
  const signature =
    req.headers["verif-hash"] || req.headers["x-flw-signature"];
  const payload = req.body;

  // ── Signature verification ─────────────────────────────────────────────────
  const secretHash = appConfig.payment.flutterwave.webhookSecretHash;
  if (!secretHash) {
    audit.error({
      action: "webhook.unconfigured_secret",
      actor: { userId: null, role: "system", ip: req.ip },
      metadata: { error: "FLW_WEBHOOK_SECRET_HASH not configured" },
    });
    return res
      .status(401)
      .json({ success: false, message: "Webhook configuration error" });
  }

  const hash = crypto
    .createHmac("sha256", secretHash)
    .update(JSON.stringify(payload))
    .digest("hex");

  // Timing-safe comparison prevents timing-attack signature probing
  const hashBuf = Buffer.from(hash, "utf8");
  const sigBuf = Buffer.from(signature || "", "utf8");
  const signatureValid =
    hashBuf.length === sigBuf.length &&
    crypto.timingSafeEqual(hashBuf, sigBuf);

  if (!signatureValid) {
    audit.error({
      action: "webhook.invalid_signature",
      actor: { userId: null, role: "system", ip: req.ip },
      metadata: { event: payload.event, signature },
    });
    return res.status(401).json({ success: false, message: "Invalid signature" });
  }

  // ── Acknowledge immediately ────────────────────────────────────────────────
  // Flutterwave requires a quick response; heavy DB work runs in the background.
  res.status(200).json({ success: true, message: "Webhook received" });

  // ── Enqueue for async processing ───────────────────────────────────────────
  enqueueWebhookPayment(payload, req.ip).catch((err) => {
    console.error("[Webhook] Enqueue error:", err.message);
  });
});

module.exports = { handleFlutterwaveWebhook };
