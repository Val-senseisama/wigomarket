/**
 * @file searchController.js
 * @description Production-grade global search with fuzzy matching,
 *              relevance scores, recent searches, and autocomplete.
 *
 * SEARCH STRATEGY (tiered):
 *   Tier 1 — MongoDB Atlas Search ($search) with fuzzy operator
 *            Provides typo tolerance, relevance scoring, case-insensitive.
 *   Tier 2 — Regex fallback when Atlas Search indexes are not configured.
 *            Uses case-insensitive regex on key fields.
 *
 * All search endpoints are public (no auth) except recent-search
 * management which requires authentication.
 */

const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const Category = require("../models/categoryModel");
const SearchHistory = require("../models/searchHistoryModel");
const redisClient = require("../config/redisClient");

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build n-gram regex tokens from a raw query for fuzzy-ish matching.
 * Splits on whitespace; each token becomes a case-insensitive regex.
 */
function buildFuzzyRegex(query) {
  const sanitized = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(sanitized, "i");
}

/**
 * Compute a simple relevance score for regex-based fallback results.
 * Higher is better.
 */
function computeRelevance(doc, query) {
  const q = query.toLowerCase();
  let score = 0;

  const title = (doc.title || doc.name || "").toLowerCase();
  const desc = (doc.description || doc.address || "").toLowerCase();
  const brand = (doc.brand || "").toLowerCase();
  const tags = (doc.tags || []).map((t) => t.toLowerCase());

  // Exact match in title — highest weight
  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q)) score += 30;

  // Word-level matching (handles multi-word queries)
  const queryWords = q.split(/\s+/).filter(Boolean);
  const titleWords = title.split(/\s+/);
  for (const qw of queryWords) {
    if (titleWords.some((tw) => tw.startsWith(qw))) score += 15;
    if (desc.includes(qw)) score += 5;
    if (brand.includes(qw)) score += 10;
    if (tags.some((t) => t.includes(qw))) score += 8;
  }

  // Popularity boost
  score += Math.min((doc.sold || 0) * 0.1, 10);
  score += Math.min(
    (doc.rating?.average || 0) * (doc.rating?.count || 0) * 0.05,
    5,
  );

  return Math.round(score * 100) / 100;
}

// ── Atlas Search helpers ───────────────────────────────────────────────────

function buildAtlasProductPipeline(query, skip, limit) {
  return [
    {
      $search: {
        index: "product_search",
        compound: {
          should: [
            {
              text: {
                query,
                path: "title",
                fuzzy: { maxEdits: 2, prefixLength: 1 },
                score: { boost: { value: 5 } },
              },
            },
            {
              text: {
                query,
                path: "brand",
                fuzzy: { maxEdits: 1 },
                score: { boost: { value: 3 } },
              },
            },
            {
              text: {
                query,
                path: "description",
                fuzzy: { maxEdits: 2, prefixLength: 2 },
                score: { boost: { value: 1 } },
              },
            },
            {
              text: {
                query,
                path: "tags",
                fuzzy: { maxEdits: 1 },
                score: { boost: { value: 2 } },
              },
            },
          ],
          minimumShouldMatch: 1,
        },
      },
    },
    { $match: { quantity: { $gt: 0 } } },
    { $addFields: { searchScore: { $meta: "searchScore" } } },
    { $sort: { searchScore: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: "stores",
        localField: "store",
        foreignField: "_id",
        as: "storeDetails",
      },
    },
    { $unwind: { path: "$storeDetails", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "categories",
        localField: "category",
        foreignField: "_id",
        as: "categoryDetails",
      },
    },
    { $unwind: { path: "$categoryDetails", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        title: 1,
        slug: 1,
        description: 1,
        price: 1,
        listedPrice: 1,
        brand: 1,
        quantity: 1,
        images: 1,
        tags: 1,
        sold: 1,
        views: 1,
        rating: 1,
        isFeatured: 1,
        searchScore: 1,
        "storeDetails.name": 1,
        "storeDetails.image": 1,
        "storeDetails.address": 1,
        "storeDetails._id": 1,
        "categoryDetails.name": 1,
        "categoryDetails._id": 1,
        createdAt: 1,
      },
    },
  ];
}

function buildAtlasStorePipeline(query, limit) {
  return [
    {
      $search: {
        index: "store_search",
        text: {
          query,
          path: ["name", "address"],
          fuzzy: { maxEdits: 2, prefixLength: 1 },
        },
      },
    },
    { $addFields: { searchScore: { $meta: "searchScore" } } },
    { $sort: { searchScore: -1 } },
    { $limit: limit },
    {
      $project: {
        name: 1,
        image: 1,
        address: 1,
        "location.formattedAddress": 1,
        searchScore: 1,
      },
    },
  ];
}

// ── Route Handlers ─────────────────────────────────────────────────────────

/**
 * GET /api/search?q=iphone&page=1&limit=20
 * Global search across products and stores with fuzzy matching.
 */
const globalSearch = asyncHandler(async (req, res) => {
  const { q, page = 1, limit = 20 } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: "Search query must be at least 2 characters",
    });
  }

  const query = q.trim();
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const skip = (pageNum - 1) * limitNum;

  // Cache key
  const cacheKey = `search:${query.toLowerCase()}:${pageNum}:${limitNum}`;

  try {
    // Try cache
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {
    // Redis unavailable — continue without cache
  }

  let products = [];
  let stores = [];
  let totalProducts = 0;
  let searchMode = "atlas";

  try {
    // ── Tier 1: Atlas Search ─────────────────────────────────────────
    const [atlasProducts, atlasStores] = await Promise.all([
      Product.aggregate(buildAtlasProductPipeline(query, skip, limitNum)),
      Store.aggregate(buildAtlasStorePipeline(query, 5)),
    ]);
    products = atlasProducts;
    stores = atlasStores;

    // Get total count for pagination (separate pipeline without skip/limit)
    const countPipeline = [
      {
        $search: {
          index: "product_search",
          compound: {
            should: [
              {
                text: {
                  query,
                  path: "title",
                  fuzzy: { maxEdits: 2, prefixLength: 1 },
                },
              },
              { text: { query, path: "brand", fuzzy: { maxEdits: 1 } } },
              {
                text: {
                  query,
                  path: "description",
                  fuzzy: { maxEdits: 2, prefixLength: 2 },
                },
              },
            ],
            minimumShouldMatch: 1,
          },
        },
      },
      { $match: { quantity: { $gt: 0 } } },
      { $count: "total" },
    ];
    const countResult = await Product.aggregate(countPipeline);
    totalProducts = countResult[0]?.total || 0;
  } catch (atlasErr) {
    // ── Tier 2: Regex Fallback ─────────────────────────────────────
    searchMode = "regex";
    const regex = buildFuzzyRegex(query);

    const productFilter = {
      quantity: { $gt: 0 },
      $or: [
        { title: regex },
        { description: regex },
        { brand: regex },
        { tags: regex },
      ],
    };

    const [rawProducts, productCount, rawStores] = await Promise.all([
      Product.find(productFilter)
        .populate("category", "name")
        .populate("store", "name image address")
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(productFilter),
      Store.find({
        $or: [{ name: regex }, { address: regex }],
      })
        .select("name image address location.formattedAddress")
        .limit(5)
        .lean(),
    ]);

    // Compute relevance scores for regex results
    products = rawProducts
      .map((p) => ({
        ...p,
        searchScore: computeRelevance(p, query),
        storeDetails: p.store || null,
        categoryDetails: p.category || null,
      }))
      .sort((a, b) => b.searchScore - a.searchScore);

    stores = rawStores.map((s) => ({
      ...s,
      searchScore: computeRelevance(s, query),
    }));

    totalProducts = productCount;
  }

  const response = {
    success: true,
    data: {
      products,
      stores,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalProducts / limitNum),
        totalResults: totalProducts,
        hasNext: pageNum < Math.ceil(totalProducts / limitNum),
        hasPrev: pageNum > 1,
      },
      meta: {
        query,
        searchMode,
        took: 0, // Placeholder — can be instrumented with perf hooks
      },
    },
  };

  // Cache for 10 minutes
  try {
    await redisClient.setex(cacheKey, 600, JSON.stringify(response));
  } catch (_) {}

  // Track search history (async, non-blocking)
  if (req.user?._id) {
    SearchHistory.findOneAndUpdate(
      { user: req.user._id, query: query.toLowerCase() },
      { $set: { query: query.toLowerCase() } },
      { upsert: true, new: true },
    ).catch(() => {}); // fire-and-forget
  }

  // Track analytics
  try {
    await redisClient.lPush(
      "search_analytics",
      JSON.stringify({
        query,
        timestamp: new Date().toISOString(),
        resultsCount: totalProducts,
        searchMode,
      }),
    );
  } catch (_) {}

  res.json(response);
});

/**
 * GET /api/search/suggestions?q=iph
 * Autocomplete suggestions based on product titles and store names.
 */
const getSuggestions = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 1) {
    return res.json({ success: true, data: [] });
  }

  const query = q.trim();
  const regex = new RegExp(
    `^${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    "i",
  );

  const cacheKey = `suggestions:${query.toLowerCase()}`;
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  const [productTitles, storeNames, categoryNames] = await Promise.all([
    Product.find({ title: regex, quantity: { $gt: 0 } })
      .select("title")
      .limit(5)
      .lean(),
    Store.find({ name: regex }).select("name").limit(3).lean(),
    Category.find({ name: regex }).select("name").limit(3).lean(),
  ]);

  const suggestions = [
    ...productTitles.map((p) => ({
      type: "product",
      text: p.title,
      id: p._id,
    })),
    ...storeNames.map((s) => ({ type: "store", text: s.name, id: s._id })),
    ...categoryNames.map((c) => ({
      type: "category",
      text: c.name,
      id: c._id,
    })),
  ];

  const response = { success: true, data: suggestions };

  try {
    await redisClient.setex(cacheKey, 300, JSON.stringify(response)); // 5 min
  } catch (_) {}

  res.json(response);
});

/**
 * GET /api/search/recent
 * Get the current user's last 10 unique search queries.
 */
const getRecentSearches = asyncHandler(async (req, res) => {
  const { _id: userId } = req.user;

  const recent = await SearchHistory.find({ user: userId })
    .sort({ updatedAt: -1 })
    .limit(10)
    .select("query updatedAt -_id")
    .lean();

  res.json({ success: true, data: recent });
});

/**
 * DELETE /api/search/recent
 * Clear all recent searches for the current user.
 */
const clearSearchHistory = asyncHandler(async (req, res) => {
  const { _id: userId } = req.user;
  await SearchHistory.deleteMany({ user: userId });
  res.json({ success: true, message: "Search history cleared" });
});

/**
 * DELETE /api/search/recent/:query
 * Remove a single query from the user's search history.
 */
const deleteSearchQuery = asyncHandler(async (req, res) => {
  const { _id: userId } = req.user;
  const { query } = req.params;
  await SearchHistory.deleteOne({ user: userId, query: query.toLowerCase() });
  res.json({ success: true, message: "Search entry removed" });
});

/**
 * GET /api/search/trending
 * Top 10 most searched queries (from Redis analytics).
 */
const getTrendingSearches = asyncHandler(async (req, res) => {
  const cacheKey = "trending_searches";

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  // Aggregate from search_analytics list (last 1000 entries)
  let raw = [];
  try {
    raw = await redisClient.lRange("search_analytics", 0, 999);
  } catch (_) {
    return res.json({ success: true, data: [] });
  }

  const counts = {};
  for (const entry of raw) {
    try {
      const { query } = JSON.parse(entry);
      const key = query.toLowerCase().trim();
      counts[key] = (counts[key] || 0) + 1;
    } catch (_) {}
  }

  const trending = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }));

  const response = { success: true, data: trending };

  try {
    await redisClient.setex(cacheKey, 1800, JSON.stringify(response)); // 30 min
  } catch (_) {}

  res.json(response);
});

module.exports = {
  globalSearch,
  getSuggestions,
  getRecentSearches,
  clearSearchHistory,
  deleteSearchQuery,
  getTrendingSearches,
};
