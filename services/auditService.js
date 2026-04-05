/**
 * @file auditService.js
 * @description Buffered, fire-and-forget audit logger.
 *
 * Entries accumulate in an in-memory buffer. The buffer flushes automatically
 * when it hits BATCH_SIZE (10) or after FLUSH_INTERVAL_MS (30 s) — whichever
 * comes first. A process-exit handler attempts a final synchronous-style flush
 * so no entries are lost on graceful shutdown.
 *
 * Failures are logged to console.error and never propagate to callers.
 *
 * Usage:
 *   const audit = require('../../services/auditService');
 *
 *   audit.log({
 *     action:   'order.created',
 *     actor:    audit.actor(req),
 *     resource: { type: 'order', id: order._id, displayName: `#${order.paymentIntent.id}` },
 *     changes:  { after: { paymentMethod, totalAmount } },
 *   });
 */

const AuditLog = require("../models/auditLogModel");
const { notifyAdmins } = require("./alertService");

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000; // 30 seconds

let buffer = [];
let flushTimer = null;

const criticalActions = [
  "auth.brute_force_detected",
  "finance.wallet_drift_detected",
  "webhook.invalid_signature",
  "payment.webhook_amount_mismatch",
  "vat.config_changed",
  "wallet.withdrawal_failed",
  "payment.refund_failed",
];

// ── Core flush ────────────────────────────────────────────────────────────────

async function flush() {
  if (buffer.length === 0) return;

  // Grab the current batch and reset the buffer immediately so new
  // entries that arrive during the async write go into a fresh batch.
  const batch = buffer;
  buffer = [];

  try {
    await AuditLog.insertMany(batch, { ordered: false });
  } catch (err) {
    // ordered: false means partial inserts still succeed; we only log the error.
    console.error(
      `[Audit] insertMany failed (${batch.length} entries):`,
      err.message,
    );
  }
}

// ── Timer management ──────────────────────────────────────────────────────────

function scheduleFlush() {
  if (flushTimer) return; // already scheduled
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the Node process alive just for audit flushing
  if (flushTimer.unref) flushTimer.unref();
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function onExit() {
  if (buffer.length === 0) return;
  // Best-effort synchronous-style drain on exit — insertMany is async so we
  // call it and let the event loop handle it before the process fully closes.
  flush().catch(() => {});
}

process.once("exit", onExit);
process.once("SIGINT", () => {
  onExit();
  process.exit(0);
});
process.once("SIGTERM", () => {
  onExit();
  process.exit(0);
});

// ── Public API ────────────────────────────────────────────────────────────────

const audit = {
  /**
   * Extract actor fields from an Express request.
   * Safe to call even if req.user is not set.
   */
  actor(req) {
    return {
      userId: req.user?._id,
      email: req.user?.email,
      role: req.activeRole || req.user?.activeRole,
      ip: req.headers?.["x-forwarded-for"]?.split(",")[0] || req.ip,
      userAgent: req.headers?.["user-agent"],
    };
  },

  /**
   * Queue an audit entry. Never throws.
   *
   * @param {Object} params
   * @param {string}  params.action       - e.g. 'order.created'
   * @param {Object}  params.actor        - { userId, email, role, ip, userAgent }
   * @param {Object}  params.resource     - { type, id, displayName }
   * @param {Object}  [params.changes]    - { before, after }
   * @param {Object}  [params.metadata]   - any extra context
   * @param {string}  [params.status]     - 'success' | 'failed'
   */
  log({
    action,
    actor = {},
    resource = {},
    changes = {},
    metadata = {},
    status = "success",
  }) {
    buffer.push({
      action,
      actor,
      resource,
      changes,
      metadata,
      status,
      createdAt: new Date(),
    });

    if (buffer.length >= BATCH_SIZE) {
      // Clear any pending timer — we're flushing now
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
    } else {
      scheduleFlush();
    }
  },

  /**
   * Helper for logging failures.
   */
  error(params) {
    this.log({ ...params, status: "failed" });

    if (criticalActions.includes(params.action)) {
      notifyAdmins(
        `Critical Failure: ${params.action}`,
        `A critical financial operation failed. Action: ${params.action}. Resource Type: ${params.resource?.type || "unknown"}.`,
        params.metadata || {},
      ).catch((err) =>
        console.error("[Audit] Failed to trigger admin alert:", err.message),
      );
    }
  },

  /**
   * Run a consistency check between wallet balances and the transaction ledger
   * @param {string} userId - Optional userId to check specific wallet
   */
  async verifyWalletHealth(userId = null) {
    const Wallet = require("../models/walletModel");
    const Transaction = require("../models/transactionModel");

    const query = userId ? { user: userId } : {};
    const wallets = await Wallet.find(query);

    for (const wallet of wallets) {
      const ledgerSum = await Transaction.aggregate([
        { $match: { "entries.userId": wallet.user, status: "completed" } },
        { $unwind: "$entries" },
        { $match: { "entries.userId": wallet.user } },
        {
          $group: {
            _id: null,
            total: {
              $sum: { $subtract: ["$entries.credit", "$entries.debit"] },
            },
          },
        },
      ]);

      const calculatedBalance = ledgerSum[0]?.total || 0;
      const drift = Math.abs(wallet.balance - calculatedBalance);

      if (drift > 0.01) {
        // Allow for minor floating point diffs
        this.error({
          action: "finance.wallet_drift_detected",
          resource: { type: "wallet", id: wallet._id },
          metadata: {
            userId: wallet.user,
            walletBalance: wallet.balance,
            ledgerBalance: calculatedBalance,
            drift,
          },
        });
      }
    }
  },

  /** Manually flush — useful in tests or health-check endpoints. */
  flush,
};

module.exports = audit;
