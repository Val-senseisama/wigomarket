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
 *     description: |
 *       Fuzzy full-text search over products (title, brand, description, tags)
 *       and store names/addresses. Returns relevance-scored results and
 *       pagination metadata.
 *
 *       **Search strategy (auto-selected):**
 *       - **atlas** — MongoDB Atlas Search with up to 2-edit typo tolerance.
 *         Filters run inside the Atlas compound query for maximum performance.
 *       - **regex** — Fallback when Atlas indexes are not configured.
 *         Contains-mode case-insensitive regex with client-side scoring.
 *
 *       The `meta.searchMode` field in the response tells you which tier ran.
 *       `meta.took` is the actual milliseconds spent in the database.
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 2 }
 *         description: Search query. Supports typos via fuzzy matching.
 *         example: "iphon"
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *         description: Page number for product results.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 50 }
 *         description: Products per page (stores are always capped at 5).
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: |
 *           Filter products by category ID (MongoDB ObjectId).
 *           Get IDs from `GET /api/home/categories`.
 *         example: "664abc123def456789012345"
 *       - in: query
 *         name: brand
 *         schema: { type: string }
 *         description: |
 *           Filter products by brand (case-insensitive contains match).
 *         example: "Samsung"
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *         description: Minimum listed price (inclusive).
 *         example: 5000
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *         description: Maximum listed price (inclusive).
 *         example: 150000
 *     responses:
 *       200:
 *         description: Search results with relevance scores
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     products:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id: { type: string }
 *                           title: { type: string }
 *                           slug: { type: string }
 *                           listedPrice: { type: number }
 *                           brand: { type: string }
 *                           images: { type: array, items: { type: string } }
 *                           rating:
 *                             type: object
 *                             properties:
 *                               average: { type: number }
 *                               count: { type: integer }
 *                           searchScore: { type: number, description: "Atlas relevance score (omitted in regex mode)" }
 *                           storeDetails:
 *                             type: object
 *                             properties:
 *                               _id: { type: string }
 *                               name: { type: string }
 *                               image: { type: string }
 *                               address: { type: string }
 *                           categoryDetails:
 *                             type: object
 *                             properties:
 *                               _id: { type: string }
 *                               name: { type: string }
 *                     stores:
 *                       type: array
 *                       maxItems: 5
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id: { type: string }
 *                           name: { type: string }
 *                           image: { type: string }
 *                           address: { type: string }
 *                           searchScore: { type: number }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage: { type: integer }
 *                         totalPages: { type: integer }
 *                         totalResults: { type: integer }
 *                         hasNext: { type: boolean }
 *                         hasPrev: { type: boolean }
 *                     meta:
 *                       type: object
 *                       properties:
 *                         query: { type: string }
 *                         searchMode: { type: string, enum: [atlas, regex] }
 *                         took: { type: integer, description: "Query time in milliseconds" }
 *                         filters:
 *                           type: object
 *                           properties:
 *                             category: { type: string, nullable: true }
 *                             brand: { type: string, nullable: true }
 *                             minPrice: { type: number, nullable: true }
 *                             maxPrice: { type: number, nullable: true }
 *       400:
 *         description: Query too short (< 2 chars)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get("/", globalSearch);

/**
 * @swagger
 * /api/search/suggestions:
 *   get:
 *     summary: Autocomplete / type-ahead suggestions
 *     description: |
 *       Returns up to 11 suggestions (5 products + 3 stores + 3 categories)
 *       as the user types.
 *
 *       **Matching strategy:**
 *       - **atlas** — Uses the Atlas `autocomplete` operator (requires the
 *         `title` / `name` fields to be indexed with an `autocomplete` tokenizer).
 *         Supports fuzzy partial-word matching anywhere in the string.
 *       - **regex fallback** — Contains-mode case-insensitive regex.
 *         Matches the query anywhere in the string, not just at the start.
 *         "pho" → "smartphone", "headphone", "samsung phone".
 *
 *       Results are cached for 5 minutes.
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string, minLength: 1 }
 *         description: Partial query string (1+ chars).
 *         example: "ipho"
 *     responses:
 *       200:
 *         description: Suggestion list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                         enum: [product, store, category]
 *                       text:
 *                         type: string
 *                         example: "iPhone 15 Pro"
 *                       id:
 *                         type: string
 *                         example: "664abc123def456789012345"
 */
router.get("/suggestions", getSuggestions);

/**
 * @swagger
 * /api/search/trending:
 *   get:
 *     summary: Top trending search queries
 *     description: |
 *       Returns the top 10 most searched queries derived from the last
 *       1,000 search events stored in Redis. Results are cached for 30 minutes.
 *     tags: [Search]
 *     responses:
 *       200:
 *         description: Trending queries sorted by search volume
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       query: { type: string, example: "iphone" }
 *                       count: { type: integer, example: 42 }
 */
router.get("/trending", getTrendingSearches);

// ── Authenticated endpoints ────────────────────────────────────────────────

/**
 * @swagger
 * /api/search/recent:
 *   get:
 *     summary: Get user's recent search queries
 *     description: Returns the authenticated user's last 10 unique search queries, most recent first.
 *     tags: [Search]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Recent search queries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       query: { type: string }
 *                       updatedAt: { type: string, format: date-time }
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
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
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
 *         description: The exact query string to remove (case-insensitive).
 *         example: iphone
 *     responses:
 *       200:
 *         description: Entry removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Success' }
 */
router.delete("/recent/:query", authMiddleware, deleteSearchQuery);

module.exports = router;
