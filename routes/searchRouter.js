const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const {
  globalSearch,
  getSuggestions,
  getRecentSearches,
  clearSearchHistory,
  deleteSearchQuery,
  getTrendingSearches,
} = require("../controllers/searchController");

// ── Public endpoints ───────────────────────────────────────────────────────

/**
 * @swagger
 * /api/search:
 *   get:
 *     summary: Global search across products and stores
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Search query (min 2 chars). Supports typos via fuzzy matching.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Search results with relevance scores
 */
router.get("/", globalSearch);

/**
 * @swagger
 * /api/search/suggestions:
 *   get:
 *     summary: Autocomplete suggestions (type-ahead)
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of suggestion objects with type and text
 */
router.get("/suggestions", getSuggestions);

/**
 * @swagger
 * /api/search/trending:
 *   get:
 *     summary: Top trending search queries
 *     tags: [Search]
 *     responses:
 *       200:
 *         description: Array of { query, count }
 */
router.get("/trending", getTrendingSearches);

// ── Authenticated endpoints ────────────────────────────────────────────────

/**
 * @swagger
 * /api/search/recent:
 *   get:
 *     summary: Get user's recent search queries
 *     tags: [Search]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Array of recent search queries
 */
router.get("/recent", authMiddleware, getRecentSearches);

/**
 * @swagger
 * /api/search/recent:
 *   delete:
 *     summary: Clear all recent searches
 *     tags: [Search]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: History cleared
 */
router.delete("/recent", authMiddleware, clearSearchHistory);

/**
 * @swagger
 * /api/search/recent/{query}:
 *   delete:
 *     summary: Remove a single search query from history
 *     tags: [Search]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: query
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Entry removed
 */
router.delete("/recent/:query", authMiddleware, deleteSearchQuery);

module.exports = router;
