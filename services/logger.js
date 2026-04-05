/**
 * @file logger.js
 * @description Centralised Winston logger built for ephemeral hosting environments.
 *
 * EPHEMERAL ENVIRONMENT DESIGN:
 *   The file system is wiped on every restart (Railway, Render, Fly.io, Heroku, etc.).
 *   Do NOT rely on log files for persistence. This logger uses two always-on transports:
 *
 *   1. Console (stdout)  — captured and shown by every hosting platform's log viewer.
 *                          Zero configuration needed. Works everywhere.
 *   2. MongoDB           — app_logs collection in your existing database.
 *                          Persists across restarts. Queryable via /api/admin/app-logs.
 *                          Stores info + warn + error (not debug/http — keeps it lean).
 *
 * OPTIONAL — for a proper log UI (free, no credit card):
 *   Axiom (https://axiom.co)  — 500 GB / month free tier.
 *   Set AXIOM_TOKEN + AXIOM_DATASET env vars and run:
 *     npm install @axiomhq/winston
 *   The transport activates automatically when those env vars are present.
 *
 * FILE LOGGING (opt-in):
 *   Set LOG_TO_FILE=true to enable rotating daily log files.
 *   Only use this in environments with persistent storage (dedicated VPS / Docker volume).
 *
 * ENV VARS:
 *   MONGO_URL          — required for MongoDB transport
 *   LOG_LEVEL          — override log level (default: debug in dev, info in prod)
 *   LOG_TO_FILE        — set to "true" to enable rotating log files
 *   AXIOM_TOKEN        — Axiom API token (enables Axiom transport)
 *   AXIOM_DATASET      — Axiom dataset name (required when AXIOM_TOKEN is set)
 *   NODE_ENV           — "production" switches console to JSON format
 *
 * USAGE:
 *   const logger = require('./services/logger');
 *   logger.info('Payment initialized', { orderId, amount });
 *   logger.error('Webhook failed', { error: err.message, stack: err.stack });
 *   logger.warn('Wallet drift', { userId, drift });
 */

const winston = require("winston");
const path = require("path");

const isProd = process.env.NODE_ENV === "production";
const LOG_LEVEL = process.env.LOG_LEVEL || (isProd ? "info" : "debug");

// ── Formats ───────────────────────────────────────────────────────────────────

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const extras =
      Object.keys(meta).length > 0
        ? "\n" + JSON.stringify(meta, null, 2)
        : "";
    return `${timestamp} [${level}]: ${stack || message}${extras}`;
  }),
);

// ── Console transport (always on) ─────────────────────────────────────────────
// In production: JSON lines — easy for platforms to parse and index.
// In development: colorised human-readable output.

const transports = [
  new winston.transports.Console({
    format: isProd ? jsonFormat : devFormat,
  }),
];

// ── File transports (opt-in only) ─────────────────────────────────────────────
// Only enabled when LOG_TO_FILE=true. Do NOT enable on ephemeral file systems —
// the files vanish on restart and give a false sense of log persistence.

if (process.env.LOG_TO_FILE === "true") {
  const logsDir = path.join(__dirname, "../logs");
  require("fs").mkdirSync(logsDir, { recursive: true });

  try {
    const DailyRotate = require("winston-daily-rotate-file");

    transports.push(
      new DailyRotate({
        filename: path.join(logsDir, "app-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxFiles: "30d",
        maxSize: "50m",
        level: "info",
        format: jsonFormat,
      }),
    );
    transports.push(
      new DailyRotate({
        filename: path.join(logsDir, "error-%DATE%.log"),
        datePattern: "YYYY-MM-DD",
        maxFiles: "90d",
        maxSize: "20m",
        level: "error",
        format: jsonFormat,
      }),
    );
  } catch {
    console.warn("[Logger] LOG_TO_FILE=true but winston-daily-rotate-file is not installed — file logging skipped");
  }
}

// ── Logger instance ───────────────────────────────────────────────────────────

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: jsonFormat,
  transports,
  exitOnError: false,
});

// ── MongoDB transport (lazy — call after DB connects) ─────────────────────────
// Stores info+ in app_logs collection. Persists across container restarts
// as long as your MongoDB is a managed/persistent service (Atlas, Railway DB, etc.).

let mongoTransportAdded = false;

logger.enableMongoTransport = function () {
  if (mongoTransportAdded) return; // idempotent

  const mongoUrl = process.env.MONGODB_URI;
  if (!mongoUrl) {
    this.warn("[Logger] MONGODB_URI not set — MongoDB log transport disabled");
    return;
  }

  try {
    require("winston-mongodb");
    this.add(
      new winston.transports.MongoDB({
        db: mongoUrl,
        collection: "app_logs",
        // Store info+ so operational events (payment initialized, order updated)
        // are captured — not just warnings and errors.
        level: "info",
        storeHost: true,
        // Capped collection: rolls over when it reaches 50 k documents.
        // This prevents unbounded growth without needing a cron to purge.
        capped: true,
        cappedMax: 50_000,
        // Belt-and-suspenders: TTL index removes documents older than 30 days
        // in case the capped collection doesn't roll over fast enough on low-traffic instances.
        expireAfterSeconds: 30 * 24 * 60 * 60,
        metaKey: "meta",
        format: jsonFormat,
      }),
    );
    mongoTransportAdded = true;
    this.info("[Logger] MongoDB log transport active (app_logs collection, info+)");
  } catch (err) {
    this.warn("[Logger] winston-mongodb not available — DB log transport disabled", {
      reason: err.message,
    });
  }
};

// ── Axiom transport (optional — free external log viewer) ─────────────────────
// Axiom gives you a searchable, filterable log UI at https://app.axiom.co.
// Free tier: 500 GB / month, no credit card required.
//
// To enable:
//   1. Sign up at https://axiom.co (free)
//   2. Create a dataset (e.g. "wigomarket-prod")
//   3. Generate an API token under Settings → API Tokens
//   4. npm install @axiomhq/winston
//   5. Set AXIOM_TOKEN and AXIOM_DATASET in your env vars

let axiomTransportAdded = false;

logger.enableAxiomTransport = function () {
  if (axiomTransportAdded) return;

  const token = process.env.AXIOM_TOKEN;
  const dataset = process.env.AXIOM_DATASET;

  if (!token || !dataset) return; // silently skip if not configured

  try {
    const { WinstonTransport: AxiomTransport } = require("@axiomhq/winston");
    this.add(
      new AxiomTransport({
        dataset,
        token,
        level: "info",
      }),
    );
    axiomTransportAdded = true;
    this.info(`[Logger] Axiom transport active → dataset: ${dataset}`);
  } catch {
    this.warn("[Logger] AXIOM_TOKEN set but @axiomhq/winston is not installed. Run: npm install @axiomhq/winston");
  }
};

// ── Global process error handlers ─────────────────────────────────────────────

logger.setupGlobalHandlers = function () {
  process.on("uncaughtException", (err) => {
    this.error("Uncaught Exception — process will exit", {
      error: err.message,
      stack: err.stack,
    });
    // Give transports time to flush before the process dies
    setTimeout(() => process.exit(1), 500);
  });

  process.on("unhandledRejection", (reason) => {
    this.error("Unhandled Promise Rejection", {
      reason: reason?.message ?? String(reason),
      stack: reason?.stack,
    });
    // Do not exit — log loudly so it gets fixed, but don't kill the server
  });
};

module.exports = logger;
