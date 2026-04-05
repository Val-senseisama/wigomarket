/**
 * @file adminRouter.js
 * @description Admin-only endpoints for audit trail and application log querying.
 *
 * All routes require authentication + admin role.
 *
 * Audit logs  → stored in the AuditLog collection (90-day TTL)
 * App logs    → stored in the app_logs collection by Winston MongoDB transport (30-day TTL)
 *               Only available when MONGO_URL is set and winston-mongodb is installed.
 */

const express = require("express");
const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const AuditLog = require("../models/auditLogModel");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");

const router = express.Router();

// All routes in this file require admin access
router.use(authMiddleware, isAdmin);

// ── Audit logs ────────────────────────────────────────────────────────────────

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAppLogsCollection() {
  return mongoose.connection.db.collection("app_logs");
}

// Level hierarchy: requesting 'warn' returns warn + error, etc.
const LEVEL_SETS = {
  error: ["error"],
  warn:  ["error", "warn"],
  info:  ["error", "warn", "info"],
  http:  ["error", "warn", "info", "http"],
  debug: ["error", "warn", "info", "http", "debug"],
};

// ── Audit logs ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit-logs
 *
 * Query parameters (all optional):
 *   action       — partial match on action string, e.g. "payment"
 *   userId       — filter by actor user ID
 *   resourceType — order | product | store | user | wallet | payment | transaction | system | …
 *   resourceId   — filter by affected resource ID
 *   status       — success | failed
 *   requestId    — correlate with a specific HTTP request
 *   startDate    — ISO date string, inclusive
 *   endDate      — ISO date string, inclusive
 *   page         — page number (default 1)
 *   limit        — results per page (default 50, max 100)
 */
router.get(
  "/audit-logs",
  asyncHandler(async (req, res) => {
    const {
      action,
      userId,
      resourceType,
      resourceId,
      status,
      requestId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = req.query;

    const filter = {};
    if (action) filter.action = { $regex: action, $options: "i" };
    if (userId) filter["actor.userId"] = userId;
    if (resourceType) filter["resource.type"] = resourceType;
    if (resourceId) filter["resource.id"] = resourceId;
    if (status) filter.status = status;
    if (requestId) filter.requestId = requestId;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * pageSize;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / pageSize),
          hasMore: skip + logs.length < total,
        },
      },
    });
  }),
);

/**
 * GET /api/admin/audit-logs/:id
 * Retrieve a single audit log entry.
 */
router.get(
  "/audit-logs/:id",
  asyncHandler(async (req, res) => {
    const log = await AuditLog.findById(req.params.id).lean();
    if (!log) {
      return res.status(404).json({ success: false, message: "Log entry not found" });
    }
    res.json({ success: true, data: log });
  }),
);

/**
 * GET /api/admin/audit-logs/summary
 * Aggregated counts by action for the last 30 days — useful for dashboards.
 */
router.get(
  "/audit-logs/summary",
  asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byAction, byStatus, byResource] = await Promise.all([
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$action", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      AuditLog.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: "$resource.type", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: { period: "last_30_days", byAction, byStatus, byResource },
    });
  }),
);

// ── Application logs (Winston → MongoDB transport) ────────────────────────────

/**
 * GET /api/admin/app-logs
 *
 * Query parameters (all optional):
 *   level      — error | warn | info (returns that level AND above; default: error)
 *   requestId  — correlate with a specific HTTP request
 *   startDate  — ISO date string
 *   endDate    — ISO date string
 *   page, limit
 *
 * Returns 503 if the MongoDB log transport is not active.
 */
router.get(
  "/app-logs",
  asyncHandler(async (req, res) => {
    const {
      level = "info",
      requestId,
      search,
      startDate,
      endDate,
      page = 1,
      limit = 100,
    } = req.query;

    let collection;
    try {
      collection = getAppLogsCollection();
    } catch {
      return res.status(503).json({
        success: false,
        message: "App log collection unavailable. Ensure MONGO_URL is set and winston-mongodb is installed.",
      });
    }

    const levels = LEVEL_SETS[level] || [level];
    const filter = { level: { $in: levels } };
    if (requestId) filter["meta.requestId"] = requestId;
    if (search) filter.message = { $regex: search, $options: "i" };
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * pageSize;

    const [logs, total] = await Promise.all([
      collection.find(filter).sort({ timestamp: -1 }).skip(skip).limit(pageSize).toArray(),
      collection.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: pageNum,
          pages: Math.ceil(total / pageSize),
          hasMore: skip + logs.length < total,
        },
      },
    });
  }),
);

// ── Live log tail (Server-Sent Events) ────────────────────────────────────────
//
// GET /api/admin/app-logs/tail?level=info
//
// Streams new log entries in real time using Server-Sent Events.
// Works with: curl, browser EventSource, Postman.
//
// Example:
//   curl -N -H "Authorization: Bearer <token>" \
//        "https://yourapp.com/api/admin/app-logs/tail?level=error"
//
// The stream polls MongoDB every 2 seconds for documents newer than the last
// seen timestamp. This approach works on all MongoDB plans (no change streams
// required — change streams need a replica set / Atlas).

router.get("/app-logs/tail", (req, res) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering
  res.flushHeaders();

  const { level = "info" } = req.query;
  const levels = LEVEL_SETS[level] || [level];
  let lastSeen = new Date();
  let active = true;

  const sendEvent = (data) => {
    if (!active) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Send a heartbeat every 15 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    if (active) res.write(": heartbeat\n\n");
  }, 15_000);

  const poll = async () => {
    if (!active) return;
    try {
      const collection = getAppLogsCollection();
      const docs = await collection
        .find({ level: { $in: levels }, timestamp: { $gt: lastSeen } })
        .sort({ timestamp: 1 })
        .limit(100)
        .toArray();

      if (docs.length > 0) {
        lastSeen = docs[docs.length - 1].timestamp;
        docs.forEach((doc) => sendEvent(doc));
      }
    } catch {
      // DB not ready yet — just wait for next tick
    }

    if (active) setTimeout(poll, 2_000);
  };

  // Start polling
  setTimeout(poll, 500);

  // Clean up when the client disconnects
  req.on("close", () => {
    active = false;
    clearInterval(heartbeat);
  });
});

module.exports = router;
