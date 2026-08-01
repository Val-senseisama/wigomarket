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
const admin = require("../controllers/admin");
const {
  getPendingWithdrawals,
  processWithdrawal,
  getWithdrawalStats,
} = require("../controllers/withdrawalController");

const router = express.Router();

// All routes in this file require admin access.
// isAdmin also enforces that the caller's activeRole === "admin".
router.use(authMiddleware, isAdmin);

// ── Dashboard ───────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/overview:
 *   get:
 *     summary: Aggregated platform counts for the admin dashboard
 *     description: Totals for users, stores, orders, wallets and revenue.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 */
router.get("/overview", admin.getOverview);

// ── User management ───────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: List users
 *     description: Paginated, filterable by role, status and free-text search.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [buyer, seller, dispatch, admin] }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, inactive, suspended] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches name, email or phone
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 */
router.get("/users", admin.listUsers);
/**
 * @swagger
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get a single user with related detail
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.get("/users/:id", admin.getUserDetail);
/**
 * @swagger
 * /api/admin/users/{id}/roles:
 *   put:
 *     summary: Replace a user's roles
 *     description: Overwrites the user's role array. Audited as admin.user_roles_updated.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roles]
 *             properties:
 *               roles:
 *                 type: array
 *                 items: { type: string, enum: [buyer, seller, dispatch, admin] }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/users/:id/roles", admin.updateUserRoles);
/**
 * @swagger
 * /api/admin/users/{id}/status:
 *   put:
 *     summary: Activate, deactivate or suspend a user
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, inactive, suspended]
 *               reason:
 *                 type: string
 *                 description: Recorded in the audit trail
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/users/:id/status", admin.setUserStatus);

// ── Dispatch (rider) management ────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/dispatch-profiles:
 *   get:
 *     summary: List dispatch rider profiles
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, suspended] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 */
router.get("/dispatch-profiles", admin.listDispatchProfiles);
/**
 * @swagger
 * /api/admin/dispatch-profiles/{id}/approve:
 *   put:
 *     summary: Approve a dispatch profile
 *     description: Allows the rider to begin accepting deliveries.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/dispatch-profiles/:id/approve", admin.approveDispatchProfile);
/**
 * @swagger
 * /api/admin/dispatch-profiles/{id}/reject:
 *   put:
 *     summary: Reject a dispatch profile
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Shown to the rider and audited
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/dispatch-profiles/:id/reject", admin.rejectDispatchProfile);
/**
 * @swagger
 * /api/admin/dispatch-profiles/{id}/suspend:
 *   put:
 *     summary: Suspend an approved dispatch profile
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/dispatch-profiles/:id/suspend", admin.suspendDispatchProfile);
/**
 * @swagger
 * /api/admin/dispatch-profiles/{id}/documents/{docType}/verify:
 *   put:
 *     summary: Mark a rider's uploaded document verified or unverified
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: docType
 *         required: true
 *         schema: { type: string }
 *         description: Which uploaded document to act on
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               verified:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put(
  "/dispatch-profiles/:id/documents/:docType/verify",
  admin.verifyDispatchDocument,
);

// ── Store management ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/stores:
 *   get:
 *     summary: List stores
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 */
router.get("/stores", admin.listStores);
/**
 * @swagger
 * /api/admin/stores/{id}/status:
 *   put:
 *     summary: Change a store's status
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/stores/:id/status", admin.setStoreStatus);

// ── Order management ──────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/orders:
 *   get:
 *     summary: List all orders across stores (paginated, filterable)
 *     description: |
 *       Platform-wide order list for the admin dashboard. Same query contract as
 *       the seller order list: category (recent/ongoing/history), status,
 *       orderType, dateFrom, dateTo, search (order number or customer name),
 *       sortBy, sortOrder, page, limit.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Paginated list of order rows with category counts
 */
router.get("/orders", admin.listOrders);

/**
 * @swagger
 * /api/admin/orders/{id}:
 *   get:
 *     summary: Get full order detail (any order)
 *     description: |
 *       Full order detail for the admin order-details screen: header, buyer &
 *       delivery info, line items, totals, payment info, lifecycle timeline, and
 *       buyer note.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Order detail
 *       404:
 *         description: Order not found
 */
router.get("/orders/:id", admin.getOrderDetail);

/**
 * @swagger
 * /api/admin/orders/{id}/contact:
 *   post:
 *     summary: Send a direct message to the buyer of an order
 *     description: |
 *       Sends a free-text message to the customer who placed the order. The
 *       message is stored as an in-app notification and delivered over the
 *       buyer's enabled channels (push + email).
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 maxLength: 2000
 *                 example: "Hi, your order is being prepared and will ship today."
 *     responses:
 *       200:
 *         description: Message sent
 *       400:
 *         description: Missing or invalid message
 *       404:
 *         description: Order not found
 */
router.post("/orders/:id/contact", admin.contactCustomer);

// ── Wallet management ─────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/wallets:
 *   get:
 *     summary: List wallets, highest balance first
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, frozen, closed] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 */
router.get("/wallets", admin.listWallets);
/**
 * @swagger
 * /api/admin/wallets/{id}/status:
 *   put:
 *     summary: Freeze, close or reactivate a wallet
 *     description: A non-active wallet rejects all debits and credits.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [active, frozen, closed]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/wallets/:id/status", admin.setWalletStatus);
/**
 * @swagger
 * /api/admin/wallets/{id}/limits:
 *   put:
 *     summary: Update a wallet's withdrawal limits
 *     description: Amounts are in NGN. Enforced atomically on every withdrawal.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               dailyWithdrawal:
 *                 type: number
 *               monthlyWithdrawal:
 *                 type: number
 *               minimumBalance:
 *                 type: number
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Not found
 */
router.put("/wallets/:id/limits", admin.updateWalletLimits);

// ── Withdrawals (handlers shared with the wallet flow) ─────────────────────────

router.get("/withdrawals/pending", getPendingWithdrawals);
router.post("/withdrawals/:transactionId/process", processWithdrawal);
router.get("/withdrawals/stats", getWithdrawalStats);

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
/**
 * @swagger
 * /api/admin/audit-logs:
 *   get:
 *     summary: Query the audit trail
 *     description: >
 *       Paginated, filterable audit log. Financial, security and admin actions
 *       are retained indefinitely; routine operational entries expire after 400
 *       days. Use requestId to correlate an entry with application logs.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: action
 *         schema: { type: string }
 *         description: Exact action name, e.g. wallet.deduct
 *       - in: query
 *         name: userId
 *         schema: { type: string }
 *         description: Filter by the actor who performed the action
 *       - in: query
 *         name: resourceType
 *         schema: { type: string, enum: [order, product, category, store, user, wallet, payment, transaction, dispatch, rating, wishlist, system] }
 *       - in: query
 *         name: resourceId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [success, failed] }
 *       - in: query
 *         name: requestId
 *         schema: { type: string }
 *         description: Correlates with the x-request-id of the originating call
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 100 }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
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
/**
 * @swagger
 * /api/admin/audit-logs/{id}:
 *   get:
 *     summary: Retrieve a single audit log entry
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       404:
 *         description: Log entry not found
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
/**
 * @swagger
 * /api/admin/audit-logs/summary:
 *   get:
 *     summary: Aggregated audit counts for the last 30 days
 *     description: Counts grouped by action, status and resource type. Intended for dashboards.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
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
/**
 * @swagger
 * /api/admin/app-logs:
 *   get:
 *     summary: Query application logs
 *     description: >
 *       Reads the Winston MongoDB transport. Returns 503 when that transport is
 *       not active.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: level
 *         schema: { type: string, enum: [error, warn, info, http, debug], default: info }
 *       - in: query
 *         name: requestId
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Free-text match against the log message
 *       - in: query
 *         name: startDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: endDate
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 100, maximum: 100 }
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 *       503:
 *         description: MongoDB log transport is not active
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

/**
 * @swagger
 * /api/admin/app-logs/tail:
 *   get:
 *     summary: Stream application logs (Server-Sent Events)
 *     description: >
 *       Long-lived SSE stream that polls MongoDB every 2 seconds for new log
 *       documents. Responds with text/event-stream, not JSON.
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: level
 *         schema: { type: string, enum: [error, warn, info, http, debug], default: info }
 *     responses:
 *       200:
 *         description: SSE stream of log entries
 *         content:
 *           text/event-stream:
 *             schema: { type: string }
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Not an admin
 */
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
