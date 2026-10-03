/**
 * @file webhookPaymentProcessor.js
 * @description Processes a signature-checked payment webhook event. Charge
 * events are handled here; payout (transfer) events are handed to
 * services/withdrawalPayoutService, under the same "re-verify first" rule.
 *
 * Called by:
 *   - The BullMQ worker in paymentQueue.js  (when Redis is available)
 *   - A setImmediate fallback in paymentQueue.js  (when Redis is unavailable)
 *
 * A webhook is only a hint: the charge is re-verified with the provider's API
 * by our own reference before anything is booked, so a forged or replayed
 * event can at most trigger a harmless verification. Booking itself is
 * services/orderPaymentSettlement, shared with the verify endpoint and the
 * pending-payment cron, and is exactly-once per charge.
 */

const payments = require("./payments");
const { settleOrderPayment, findOrderByReference, SettlementError } = require("./orderPaymentSettlement");

/**
 * @param {Object} job
 * @param {string} job.provider  - adapter name the webhook came from
 * @param {Object} job.event     - provider.parseWebhook() result
 * @param {string} [job.sourceIp] - originating IP (for audit logs)
 * @returns {Promise<{ result: string }>}
 */
async function processChargeEvent({ provider, event, sourceIp = "webhook" }) {
  if (event?.type !== "charge.succeeded") return { result: "ignored" };

  const order = await findOrderByReference(event.reference);
  if (!order) {
    console.error(`[WebhookProcessor] No order for ${provider} reference ${event.reference}`);
    return { result: "order_not_found" };
  }

  const charge = await payments.getProvider(provider).verifyCharge({ reference: event.reference });
  if (charge.status !== "succeeded") {
    // The provider does not (yet) confirm what the webhook claimed. The cron
    // will pick it up if it settles later.
    console.warn(`[WebhookProcessor] ${provider} reports ${charge.providerStatus} for ${event.reference}; not booking`);
    return { result: "not_confirmed" };
  }

  try {
    const { result } = await settleOrderPayment({
      orderId: order._id,
      provider,
      charge,
      source: "webhook",
      actor: { userId: null, role: "system", ip: sourceIp },
    });
    return { result };
  } catch (err) {
    // A mismatch will not fix itself on retry; it is already alerted.
    if (err instanceof SettlementError) return { result: err.code };
    throw err; // Re-throw so BullMQ can schedule a retry
  }
}

/**
 * Route a parsed webhook event: charges settle orders, transfer updates settle
 * withdrawal payouts (services/withdrawalPayoutService).
 */
async function processWebhookEvent(job) {
  if (job.event?.type === "transfer.updated") {
    return require("./withdrawalPayoutService").processTransferEvent(job);
  }
  return processChargeEvent(job);
}

module.exports = { processChargeEvent, processWebhookEvent };
