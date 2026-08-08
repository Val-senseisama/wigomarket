/**
 * @file auditService.js
 * @description Buffered, fire-and-forget audit logger.
 *
 * Entries accumulate in an in-memory buffer. The buffer flushes automatically
 * when it hits BATCH_SIZE (10) or after FLUSH_INTERVAL_MS (30 s) — whichever
 * comes first. `app.js` awaits a final `flush()` during graceful shutdown, so
 * no entries are lost when the platform stops the process.
 *
 * Failures are logged to console.error and never propagate to callers. A batch
 * that could not be written because the database was unreachable goes back on
 * the buffer to be retried by the next flush.
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

const mongoose = require("mongoose");
const AuditLog = require("../models/auditLogModel");
const { notifyAdmins } = require("./alertService");
const money = require("../utils/money");

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000; // 30 seconds

// Ceiling on entries held in memory while the database is unreachable. Past
// this the oldest entries are dropped (loudly) rather than growing the buffer
// without bound through a long outage.
const BUFFER_LIMIT = 1000;

let buffer = [];
let flushTimer = null;

// Entries whose action starts with one of these prefixes are retained
// indefinitely (expiresAt = null). Everything else is a routine operational
// entry and expires after RETENTION_DAYS.
const PERMANENT_PREFIXES = [
  "wallet.",
  "payment.",
  "transaction.",
  "withdrawal.",
  "finance.",
  "vat.",
  "refund.",
  "billpayment.",
  "auth.", // security events — needed for incident forensics
  "admin.", // privileged actions against other people's money/accounts
];

const RETENTION_DAYS = 400;

/**
 * Retention deadline for an entry, or null to keep it forever.
 * @param {string} action
 * @returns {Date|null}
 */
function expiryFor(action) {
  const a = String(action || "");
  if (PERMANENT_PREFIXES.some((p) => a.startsWith(p))) return null;
  return new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

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

/**
 * Put a batch back on the buffer after a failed write, newest-last so ordering
 * is preserved. Drops the oldest entries if that would exceed BUFFER_LIMIT.
 */
function requeue(batch) {
  buffer = batch.concat(buffer);

  if (buffer.length > BUFFER_LIMIT) {
    const dropped = buffer.length - BUFFER_LIMIT;
    buffer = buffer.slice(dropped);
    console.error(
      `[Audit] buffer over ${BUFFER_LIMIT} entries — dropped ${dropped} oldest`,
    );
  }
}

/**
 * Cast a buffered entry to a plain document via the schema.
 *
 * Model.insertMany() would normally do the casting, defaults and timestamps for
 * us, but we deliberately do not use it — see flush(). Returns null (after
 * logging) for an entry the schema rejects, matching the `ordered: false`
 * behaviour of skipping bad documents rather than failing the whole batch.
 */
function toDocument(entry) {
  try {
    const doc = new AuditLog(entry);
    // insertMany applies `timestamps: true`; the native driver does not.
    doc.initializeTimestamps();

    const invalid = doc.validateSync();
    if (invalid) {
      console.error(
        `[Audit] dropping invalid entry (${entry?.action}):`,
        invalid.message,
      );
      return null;
    }

    return doc.toObject({ depopulate: true });
  } catch (err) {
    console.error(
      `[Audit] dropping uncastable entry (${entry?.action}):`,
      err.message,
    );
    return null;
  }
}

async function flush() {
  if (buffer.length === 0) return;

  // Grab the current batch and reset the buffer immediately so new
  // entries that arrive during the async write go into a fresh batch.
  const batch = buffer;
  buffer = [];

  // Nothing can be written without a live connection, and attempting it is not
  // harmless (see below) — hold the batch for the next flush instead.
  if (mongoose.connection.readyState !== 1) {
    requeue(batch);
    return;
  }

  const documents = batch.map(toDocument).filter(Boolean);
  if (documents.length === 0) return;

  try {
    // Written through the native driver rather than AuditLog.insertMany().
    //
    // Mongoose 7.2's insertMany assumes any rejection from the driver is a bulk
    // write error and reads `error.writeErrors.length` on it. For a connection
    // error — pool closed during shutdown, failover, timeout — that property is
    // absent, so its own error handler throws a TypeError *before* invoking its
    // callback. The promise insertMany returned then never settles: the await
    // below would hang forever, this catch would never run, and the batch would
    // vanish without a trace. Casting above, then inserting here, keeps the
    // schema behaviour while avoiding that code path entirely.
    await AuditLog.collection.insertMany(documents, { ordered: false });
  } catch (err) {
    // ordered: false means the valid documents in the batch were still written;
    // only the rejected ones are lost, and the driver reports those.
    const failed = err.writeErrors?.length ?? documents.length;
    console.error(
      `[Audit] insert failed (${failed}/${documents.length} entries):`,
      err.message,
    );

    // A batch the server actively rejected will be rejected again on retry, so
    // only connectivity failures go back on the buffer.
    if (mongoose.connection.readyState !== 1) requeue(batch);
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

// Draining the buffer is app.js's job: its gracefulShutdown awaits flush()
// before disconnecting the database.
//
// This service used to handle SIGINT/SIGTERM itself, calling flush() and then
// process.exit(0). Both were ineffective and the second was harmful. flush() is
// async, so exiting on the next line abandoned it — nothing was ever drained.
// Worse, these handlers were registered at require time, ahead of app.js's own,
// so on the SIGTERM the platform sends to stop a dyno this exit(0) fired first
// and cut short gracefulShutdown: in-flight requests, the WebSocket server, the
// payment and task queues and the database connection all went down uncleanly.
//
// 'exit' cannot run async work at all, so it only reports what is being lost.
process.once("exit", () => {
  if (buffer.length > 0) {
    console.error(
      `[Audit] process exiting with ${buffer.length} unflushed entries`,
    );
  }
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
      expiresAt: expiryFor(action),
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
   * Write an audit entry inside an open transaction, so it commits atomically
   * with the change it describes.
   *
   * The buffered `log()` above is fire-and-forget: it batches in memory and
   * flushes later, which is fine for routine activity but means a crash between
   * a committed balance change and the next flush loses the record of money
   * having moved. Money paths use this instead — if the transaction rolls back
   * the audit entry rolls back with it, and if it commits the entry is durable.
   *
   * Unlike log(), this awaits the write and will propagate a failure, which is
   * intentional: an unauditable money movement should not silently succeed.
   *
   * @param {Object} params - same shape as log()
   * @param {mongoose.ClientSession} session
   */
  async logWithSession(
    {
      action,
      actor = {},
      resource = {},
      changes = {},
      metadata = {},
      status = "success",
    },
    session,
  ) {
    const doc = {
      action,
      actor,
      resource,
      changes,
      metadata,
      status,
      createdAt: new Date(),
      expiresAt: expiryFor(action),
    };

    // No session (e.g. a non-transactional caller) — fall back to the buffer
    // rather than failing the operation outright.
    if (!session) {
      this.log(doc);
      return null;
    }

    const [written] = await AuditLog.create([doc], { session });
    return written;
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
    const WalletDrift = require("../models/walletDriftModel");

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

      // Compare in whole kobo. The old check tolerated a 1-kobo difference to
      // absorb float noise, which meant genuine sub-kobo drift was invisible
      // and could accumulate silently. All money arithmetic now goes through
      // utils/money, so any difference at all is a real discrepancy.
      const walletKobo = money.toKobo(wallet.balance);
      const ledgerKobo = money.toKobo(calculatedBalance);

      if (walletKobo !== ledgerKobo) {
        const driftKobo = walletKobo - ledgerKobo;

        // Persist an unresolved drift record so the discrepancy has a lifecycle
        // (and survives the audit-log retention window) rather than existing
        // only as a one-off alert email.
        await WalletDrift.recordDrift({
          wallet: wallet._id,
          user: wallet.user,
          walletBalance: wallet.balance,
          ledgerBalance: calculatedBalance,
          driftKobo,
        });

        this.error({
          action: "finance.wallet_drift_detected",
          resource: { type: "wallet", id: wallet._id },
          metadata: {
            userId: wallet.user,
            walletBalance: wallet.balance,
            ledgerBalance: calculatedBalance,
            drift: money.fromKobo(driftKobo),
            driftKobo,
          },
        });
      }
    }
  },

  /** Manually flush — useful in tests or health-check endpoints. */
  flush,
};

module.exports = audit;
