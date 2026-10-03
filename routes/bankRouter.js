const express = require("express");
const {
  getBanksList,
  resolveAccountName,
  getBankByCode,
  clearBanksCache,
  getCacheStats,
} = require("../controllers/bankController");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();

// Mounted at /api/banks, and at /api/flutterwave as a deprecated alias for
// older clients (same handlers, same responses).

/**
 * @swagger
 * /api/banks:
 *   get:
 *     summary: Get list of banks
 *     description: |
 *       Nigerian banks supported by the active payment provider (Monnify by
 *       default). Use a bank's `code` as `bankCode` / `account_bank` elsewhere.
 *       Cached for 24 hours per provider.
 *
 *       Also served at the deprecated `GET /api/flutterwave/banks`.
 *     tags:
 *       - Banks
 *     responses:
 *       200:
 *         description: Banks list retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code:
 *                         type: string
 *                         example: "058"
 *                       name:
 *                         type: string
 *                         example: "Guaranty Trust Bank"
 *                 cached:
 *                   type: boolean
 *                 provider:
 *                   type: string
 *                   example: monnify
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       502:
 *         description: The payment provider could not be reached and nothing is cached
 */
router.get("/", getBanksList);
router.get("/banks", getBanksList); // legacy path under /api/flutterwave

/**
 * @swagger
 * /api/banks/{bankCode}:
 *   get:
 *     summary: Get bank by code
 *     description: |
 *       One bank from the active provider's list.
 *
 *       Also served at the deprecated `GET /api/flutterwave/banks/{bankCode}`.
 *     tags:
 *       - Banks
 *     parameters:
 *       - in: path
 *         name: bankCode
 *         required: true
 *         schema:
 *           type: string
 *         example: "058"
 *     responses:
 *       200:
 *         description: Bank found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                     name:
 *                       type: string
 *       404:
 *         description: No bank with that code
 *       502:
 *         description: The payment provider could not be reached and nothing is cached
 */
router.get("/banks/:bankCode", getBankByCode); // legacy path under /api/flutterwave

/**
 * @swagger
 * /api/banks/accounts/resolve:
 *   post:
 *     summary: Resolve account name
 *     description: |
 *       Look up the account holder's name for a bank account through the
 *       active payment provider. Cached for 1 hour.
 *
 *       Also served at the deprecated `POST /api/flutterwave/accounts/resolve`.
 *     tags:
 *       - Banks
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - account_number
 *               - account_bank
 *             properties:
 *               account_number:
 *                 type: string
 *                 description: 10-digit NUBAN
 *                 example: "0123456789"
 *               account_bank:
 *                 type: string
 *                 description: Bank code from GET /api/banks
 *                 example: "044"
 *     responses:
 *       200:
 *         description: Account resolved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     account_number:
 *                       type: string
 *                     account_name:
 *                       type: string
 *                     bank_code:
 *                       type: string
 *                 cached:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid input, or the provider could not resolve the account
 */
router.post("/accounts/resolve", resolveAccountName);

/**
 * @swagger
 * /api/banks/cache/clear:
 *   post:
 *     summary: Clear banks cache
 *     description: |
 *       Clear cached bank lists and account lookups (admin only).
 *
 *       Also served at the deprecated `POST /api/flutterwave/cache/clear`.
 *     tags:
 *       - Banks
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     clearedKeys:
 *                       type: number
 *                     keys:
 *                       type: array
 *                       items:
 *                         type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.post("/cache/clear", authMiddleware, isAdmin, clearBanksCache);

/**
 * @swagger
 * /api/banks/cache/stats:
 *   get:
 *     summary: Get banks cache statistics
 *     description: |
 *       Counts of cached bank lists and account lookups (admin only).
 *
 *       Also served at the deprecated `GET /api/flutterwave/cache/stats`.
 *     tags:
 *       - Banks
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     banksListCache:
 *                       type: number
 *                     accountResolveCache:
 *                       type: number
 *                     totalCacheEntries:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Admin access required
 */
router.get("/cache/stats", authMiddleware, isAdmin, getCacheStats);

// Declared last so it doesn't shadow /cache/* and /accounts/*.
router.get("/:bankCode", getBankByCode);

module.exports = router;
