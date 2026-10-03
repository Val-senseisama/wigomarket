/**
 * @file paymentQueue.js
 * @description BullMQ-based payment event queue with graceful fallback.
 *
 * DESIGN:
 *   When Redis is available, webhook events are enqueued as BullMQ jobs and
 *   processed asynchronously by a background Worker. This lets the webhook
 *   endpoint acknowledge the provider immediately (< 200 ms) while heavy DB
 *   work happens in the background with automatic retries.
 *
 *   When Redis is unavailable (or PAYMENT_QUEUE_ENABLED=false), jobs are
 *   executed in-process via setImmediate. The webhook still responds instantly;
 *   processing happens in the next event-loop turn. This mode has no retry on
 *   failure — rely on the 5-minute pending-payment cron as a safety net.
 *
 * USAGE (app.js):
 *   const paymentQueue = require('./services/paymentQueue');
 *   await paymentQueue.init();                   // call once after DB connects
 *   ...
 *   await paymentQueue.close();                  // call during graceful shutdown
 *
 * ENV:
 *   REDIS_URL              - Redis connection string (default: redis://localhost:6379)
 *   PAYMENT_QUEUE_ENABLED  - set to "false" to disable the queue and always use
 *                            the in-process fallback (useful in test/dev)
 */

let queue = null;
let worker = null;
let isAvailable = false;

const QUEUE_NAME = "payment-events";

/** Parse REDIS_URL into a BullMQ-compatible ioredis connection object. */
function getConnectionConfig() {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  try {
    const parsed = new URL(url);
    const options = {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 6379,
      // Redis 6 ACL: include username only when it's not the legacy "default"
      ...(parsed.username && parsed.username !== "default"
        ? { username: decodeURIComponent(parsed.username) }
        : {}),
      ...(parsed.password
        ? { password: decodeURIComponent(parsed.password) }
        : {}),
      // Both options are required by BullMQ
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };

    // Render's managed Redis requires TLS.
    // rediss:// means SSL/TLS connection.
    if (parsed.protocol === "rediss:") {
      options.tls = {};
    }

    return options;
  } catch {
    return {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };
  }
}

/**
 * Initialise the queue and its worker.
 * Safe to call even when Redis is unreachable — the queue simply stays disabled.
 */
async function init() {
  if (process.env.PAYMENT_QUEUE_ENABLED === "false") {
    console.log(
      "[PaymentQueue] Disabled via PAYMENT_QUEUE_ENABLED=false. Using in-process fallback.",
    );
    return;
  }

  try {
    const { Queue, Worker } = require("bullmq");
    const connection = getConnectionConfig();

    queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    });

    // Worker needs its own dedicated connection (BullMQ requirement)
    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        if (job.name === "webhook.payment") {
          const { processWebhookEvent } = require("./webhookPaymentProcessor");
          await processWebhookEvent(job.data);
        }
      },
      { connection: getConnectionConfig() },
    );

    worker.on("failed", (job, err) => {
      console.error(
        `[PaymentQueue] Job ${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts?.attempts}): ${err.message}`,
      );
    });

    worker.on("error", (err) => {
      console.error("[PaymentQueue] Worker error:", err.message);
    });

    await queue.waitUntilReady();
    isAvailable = true;
    console.log("[PaymentQueue] Ready (BullMQ + Redis)");
  } catch (err) {
    console.warn(
      `[PaymentQueue] Unavailable — falling back to in-process execution. Reason: ${err.message}`,
    );
    isAvailable = false;

    // Clean up partially-constructed instances
    if (queue) {
      try {
        await queue.close();
      } catch {}
      queue = null;
    }
    if (worker) {
      try {
        await worker.close();
      } catch {}
      worker = null;
    }
  }
}

/**
 * Enqueue a signature-checked, parsed webhook event for background processing.
 * Falls back to in-process setImmediate execution if the queue is unavailable.
 *
 * @param {string} provider  - Adapter name the webhook came from.
 * @param {Object} event     - provider.parseWebhook() result.
 * @param {string} sourceIp  - Originating IP (for audit logs).
 */
async function enqueueWebhookPayment(provider, event, sourceIp) {
  const data = { provider, event, sourceIp };
  if (isAvailable && queue) {
    try {
      // jobId deduplication: providers retry the same event. A payout can
      // legitimately report twice (success, then a reversal), so its status
      // is part of the key.
      const jobId =
        event.type === "transfer.updated"
          ? `webhook_${provider}_transfer_${event.reference}_${event.providerStatus}`
          : `webhook_${provider}_${event.providerTransactionId ?? event.reference}`;
      await queue.add("webhook.payment", data, { jobId });
      return;
    } catch (err) {
      console.error(
        "[PaymentQueue] Enqueue failed — running in-process:",
        err.message,
      );
    }
  }

  // Fallback: schedule in the next event-loop tick so the HTTP response
  // is sent before we start doing database work
  setImmediate(async () => {
    try {
      const { processWebhookEvent } = require("./webhookPaymentProcessor");
      await processWebhookEvent(data);
    } catch (err) {
      console.error("[PaymentQueue] In-process fallback failed:", err.message);
      try {
        const audit = require("./auditService");
        audit.error({
          action: "webhook.processing_failed",
          actor: { userId: null, role: "system", ip: sourceIp },
          metadata: { provider, reference: event.reference, error: err.message },
        });
      } catch {}
    }
  });
}

/**
 * Gracefully shut down the queue and worker.
 * Call this during application shutdown (SIGTERM / SIGINT).
 */
async function close() {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
  isAvailable = false;
}

/** @returns {boolean} Whether the BullMQ queue is active. */
function isQueueAvailable() {
  return isAvailable;
}

module.exports = { init, enqueueWebhookPayment, close, isQueueAvailable };
