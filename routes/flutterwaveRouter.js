const express = require("express");
const {
  getBanksList,
  resolveAccountName,
  getBankByCode,
  clearBanksCache,
  getCacheStats
} = require("../controllers/flutterwaveController");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * /api/flutterwave/flutterwave/banks:
 *   get:
 *     summary: Get list of banks
 *     description: Get list of banks from Flutterwave with caching
 *     tags:
 *       - Flutterwave
 *     parameters:
 *       - in: query
 *         name: country
 *         schema:
 *           type: string
 *           default: NG
 *         description: Country code
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
 *                       id:
 *                         type: number
 *                       code:
 *                         type: string
 *                       name:
 *                         type: string
 *                 cached:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
 */
router.get("/banks", getBanksList);

/**
 * @swagger
 * /api/flutterwave/flutterwave/banks/{bankCode}:
 *   get:
 *     summary: Get bank details by code
 *     description: Get specific bank details by bank code
 *     tags:
 *       - Flutterwave
 *     parameters:
 *       - in: path
 *         name: bankCode
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank code
 *     responses:
 *       200:
 *         description: Bank details retrieved successfully
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
 *                     id:
 *                       type: number
 *                     code:
 *                       type: string
 *                     name:
 *                       type: string
 *                 cached:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Bank not found
 *       500:
 *         description: Server error
 */
router.get("/banks/:bankCode", getBankByCode);

/**
 * @swagger
 * /api/flutterwave/flutterwave/accounts/resolve:
 *   post:
 *     summary: Resolve account name
 *     description: Resolve account name from bank account number and bank code
 *     tags:
 *       - Flutterwave
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
 *                 description: Bank account number
 *                 example: "0123456789"
 *               account_bank:
 *                 type: string
 *                 description: Bank code
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
 *                     bank_name:
 *                       type: string
 *                 cached:
 *                   type: boolean
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Invalid request or account not found
 *       500:
 *         description: Server error
 */
router.post("/accounts/resolve", resolveAccountName);

/**
 * @swagger
 * /api/flutterwave/flutterwave/cache/clear:
 *   post:
 *     summary: Clear banks cache
 *     description: Clear all banks and account resolution cache (Admin only)
 *     tags:
 *       - Flutterwave
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared successfully
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
 *         description: Forbidden - Admin only
 *       500:
 *         description: Server error
 */
router.post("/cache/clear", authMiddleware, isAdmin, clearBanksCache);

/**
 * @swagger
 * /api/flutterwave/flutterwave/cache/stats:
 *   get:
 *     summary: Get cache statistics
 *     description: Get cache statistics for banks and account resolution (Admin only)
 *     tags:
 *       - Flutterwave
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics retrieved successfully
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
 *                     banksListCache:
 *                       type: number
 *                     accountResolveCache:
 *                       type: number
 *                     bankDetailsCache:
 *                       type: number
 *                     totalCacheEntries:
 *                       type: number
 *                     cacheKeys:
 *                       type: object
 *                       properties:
 *                         banks:
 *                           type: array
 *                           items:
 *                             type: string
 *                         accounts:
 *                           type: array
 *                           items:
 *                             type: string
 *                         bankDetails:
 *                           type: array
 *                           items:
 *                             type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin only
 *       500:
 *         description: Server error
 */
router.get("/cache/stats", authMiddleware, isAdmin, getCacheStats);

module.exports = router;
