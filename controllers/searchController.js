/**
 * @file searchController.js
 * @description Production-grade global search with fuzzy matching,
 *              relevance scores, filters, recent searches, and autocomplete.
 *
 * SEARCH STRATEGY (tiered):
 *   Tier 1 — MongoDB Atlas Search ($search) with fuzzy operator
 *            Provides typo tolerance, relevance scoring, case-insensitive.
 *            Filters (category, price) run inside the Atlas compound.filter
 *            clause so the index pre-filters before scoring.
 *   Tier 2 — Regex fallback when Atlas Search indexes are not configured.
 *            Uses case-insensitive regex on key fields; filters applied as
 *            additional $match conditions.
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

const ANALYTICS_KEY = "search_analytics";
const ANALYTICS_CAP = 1000; // keep the most recent N entries; older ones are trimmed

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sanitise and compile a contains-mode case-insensitive regex.
 * Matches anywhere in the string (not just prefix).
 */
function buildContainsRegex(query) {
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

  if (title === q) score += 100;
  else if (title.startsWith(q)) score += 60;
  else if (title.includes(q)) score += 30;

  const queryWords = q.split(/\s+/).filter(Boolean);
  const titleWords = title.split(/\s+/);
  for (const qw of queryWords) {
    if (titleWords.some((tw) => tw.startsWith(qw))) score += 15;
    if (desc.includes(qw)) score += 5;
    if (brand.includes(qw)) score += 10;
    if (tags.some((t) => t.includes(qw))) score += 8;
  }

  score += Math.min((doc.sold || 0) * 0.1, 10);
  score += Math.min(
    (doc.rating?.average || 0) * (doc.rating?.count || 0) * 0.05,
    5,
  );

  return Math.round(score * 100) / 100;
}

// ── Atlas Search helpers ───────────────────────────────────────────────────

/**
 * Build the Atlas filter clauses from parsed filter values.
 * category and price use Atlas compound.filter (index-accelerated).
 * brand uses a post-$search $match (text filter, not a range/equality op).
 */
function buildAtlasFilters(filters) {
  const { categoryId, minPrice, maxPrice } = filters;
  const atlasFilters = [];

  if (categoryId) {
    atlasFilters.push({ equals: { path: "category", value: categoryId } });
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    const range = { path: "listedPrice" };
    if (minPrice !== undefined) range.gte = minPrice;
    if (maxPrice !== undefined) range.lte = maxPrice;
    atlasFilters.push({ range });
  }

  return atlasFilters;
}

function buildAtlasProductPipeline(query, skip, limit, filters) {
  const atlasFilters = buildAtlasFilters(filters);
  const brandRegex = filters.brand
    ? new RegExp(filters.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : null;

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
          ...(atlasFilters.length > 0 && { filter: atlasFilters }),
          minimumShouldMatch: 1,
        },
      },
    },

    // Post-search match: in-stock + optional brand string filter
    {
      $match: {
        quantity: { $gt: 0 },
        ...(brandRegex && { brand: brandRegex }),
      },
    },

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

function buildAtlasCountPipeline(query, filters) {
  const atlasFilters = buildAtlasFilters(filters);
  const brandRegex = filters.brand
    ? new RegExp(filters.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : null;

  return [
    {
      $search: {
        index: "product_search",
        compound: {
          should: [
            { text: { query, path: "title", fuzzy: { maxEdits: 2, prefixLength: 1 } } },
            { text: { query, path: "brand", fuzzy: { maxEdits: 1 } } },
            { text: { query, path: "description", fuzzy: { maxEdits: 2, prefixLength: 2 } } },
          ],
          ...(atlasFilters.length > 0 && { filter: atlasFilters }),
          minimumShouldMatch: 1,
        },
      },
    },
    {
      $match: {
        quantity: { $gt: 0 },
        ...(brandRegex && { brand: brandRegex }),
      },
    },
    { $count: "total" },
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
 * GET /api/search?q=iphone&page=1&limit=20&category=<id>&brand=Apple&minPrice=5000&maxPrice=200000
 * Global search across products and stores with fuzzy matching and optional filters.
 */
const globalSearch = asyncHandler(async (req, res) => {
  const {
    q,
    page = 1,
    limit = 20,
    category,
    brand,
    minPrice,
    maxPrice,
  } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({
      success: false,
      message: "Search query must be at least 2 characters",
    });
  }

  const query   = q.trim();
  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
  const skip    = (pageNum - 1) * limitNum;

  // ── Parse filters ──────────────────────────────────────────────────────
  const categoryId =
    category && mongoose.isValidObjectId(category)
      ? new mongoose.Types.ObjectId(category)
      : null;
  const minPriceNum = minPrice !== undefined ? parseFloat(minPrice) : undefined;
  const maxPriceNum = maxPrice !== undefined ? parseFloat(maxPrice) : undefined;

  const filters = {
    categoryId,
    brand: brand?.trim() || null,
    minPrice: minPriceNum,
    maxPrice: maxPriceNum,
  };

  // Cache key includes all filter dimensions
  const cacheKey = [
    "search",
    query.toLowerCase(),
    pageNum,
    limitNum,
    category || "",
    (brand || "").toLowerCase(),
    minPrice || "",
    maxPrice || "",
  ].join(":");

  // ── Cache read ─────────────────────────────────────────────────────────
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {
    // Redis unavailable — continue to DB
  }

  // ── DB query ───────────────────────────────────────────────────────────
  const t0 = Date.now();
  let products = [];
  let stores = [];
  let totalProducts = 0;
  let searchMode = "atlas";

  try {
    // ── Tier 1: Atlas Search ─────────────────────────────────────────────
    const [atlasProducts, atlasStores, countResult] = await Promise.all([
      Product.aggregate(buildAtlasProductPipeline(query, skip, limitNum, filters)),
      Store.aggregate(buildAtlasStorePipeline(query, 5)),
      Product.aggregate(buildAtlasCountPipeline(query, filters)),
    ]);

    products = atlasProducts;
    stores = atlasStores;
    totalProducts = countResult[0]?.total || 0;
  } catch (_atlasErr) {
    // ── Tier 2: Regex Fallback ───────────────────────────────────────────
    searchMode = "regex";
    const regex = buildContainsRegex(query);
    const brandFilterRegex = filters.brand
      ? new RegExp(filters.brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
      : null;

    const priceFilter =
      minPriceNum !== undefined || maxPriceNum !== undefined
        ? {
            ...(minPriceNum !== undefined && { $gte: minPriceNum }),
            ...(maxPriceNum !== undefined && { $lte: maxPriceNum }),
          }
        : null;

    const productFilter = {
      quantity: { $gt: 0 },
      $or: [
        { title: regex },
        { description: regex },
        { brand: regex },
        { tags: regex },
      ],
      ...(categoryId && { category: categoryId }),
      ...(brandFilterRegex && { brand: brandFilterRegex }),
      ...(priceFilter && { listedPrice: priceFilter }),
    };

    const [rawProducts, productCount, rawStores] = await Promise.all([
      Product.find(productFilter)
        .populate("category", "name")
        .populate("store", "name image address")
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(productFilter),
      Store.find({ $or: [{ name: regex }, { address: regex }] })
        .select("name image address location.formattedAddress")
        .limit(5)
        .lean(),
    ]);

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

  const totalPages = Math.ceil(totalProducts / limitNum);

  const response = {
    success: true,
    data: {
      products,
      stores,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalResults: totalProducts,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
      meta: {
        query,
        searchMode,
        took: Date.now() - t0,   // ms elapsed for the DB queries
        filters: {
          category: category || null,
          brand: filters.brand || null,
          minPrice: minPriceNum ?? null,
          maxPrice: maxPriceNum ?? null,
        },
      },
    },
  };

  // ── Cache write ────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, 600, JSON.stringify(response));
  } catch (_) {}

  // Track search history (async, non-blocking)
  if (req.user?._id) {
    SearchHistory.findOneAndUpdate(
      { user: req.user._id, query: query.toLowerCase() },
      { $set: { query: query.toLowerCase() } },
      { upsert: true, new: true },
    ).catch(() => {});
  }

  // Track analytics — cap list to ANALYTICS_CAP entries
  try {
    await redisClient.lPush(
      ANALYTICS_KEY,
      JSON.stringify({
        query,
        timestamp: new Date().toISOString(),
        resultsCount: totalProducts,
        searchMode,
      }),
    );
    await redisClient.lTrim(ANALYTICS_KEY, 0, ANALYTICS_CAP - 1);
  } catch (_) {}

  res.json(response);
});

/**
 * GET /api/search/suggestions?q=iph
 * Autocomplete suggestions.
 *   Tier 1 — Atlas autocomplete operator (edge-gram / any-position fuzzy)
 *   Tier 2 — Contains-mode regex fallback (matches anywhere in the string,
 *             not just the prefix, so "pho" matches "smartphone")
 */
const getSuggestions = asyncHandler(async (req, res) => {
  const { q } = req.query;

  if (!q || q.trim().length < 1) {
    return res.json({ success: true, data: [] });
  }

  const query = q.trim();
  const cacheKey = `suggestions:${query.toLowerCase()}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  let productTitles = [];
  let storeNames = [];

  try {
    // ── Tier 1: Atlas autocomplete ───────────────────────────────────────
    // Requires the 'title' field to be indexed as type "autocomplete" in the
    // product_search index, and 'name' in store_search.
    [productTitles, storeNames] = await Promise.all([
      Product.aggregate([
        {
          $search: {
            index: "product_search",
            autocomplete: {
              query,
              path: "title",
              fuzzy: { maxEdits: 1 },
              tokenOrder: "any",
            },
          },
        },
        { $match: { quantity: { $gt: 0 } } },
        { $limit: 5 },
        { $project: { title: 1 } },
      ]),
      Store.aggregate([
        {
          $search: {
            index: "store_search",
            autocomplete: {
              query,
              path: "name",
              fuzzy: { maxEdits: 1 },
            },
          },
        },
        { $limit: 3 },
        { $project: { name: 1 } },
      ]),
    ]);
  } catch (_) {
    // ── Tier 2: contains-regex fallback ─────────────────────────────────
    // Uses a contains match (not just ^prefix) so mid-word tokens work:
    // "pho" → "smartphone", "samsung phone", etc.
    const regex = buildContainsRegex(query);
    [productTitles, storeNames] = await Promise.all([
      Product.find({ title: regex, quantity: { $gt: 0 } })
        .select("title")
        .limit(5)
        .lean(),
      Store.find({ name: regex }).select("name").limit(3).lean(),
    ]);
  }

  // Categories always use contains regex — collection is small, Atlas not needed
  const catRegex = buildContainsRegex(query);
  const categoryNames = await Category.find({ name: catRegex })
    .select("name")
    .limit(3)
    .lean();

  const suggestions = [
    ...productTitles.map((p) => ({ type: "product", text: p.title, id: p._id })),
    ...storeNames.map((s) => ({ type: "store", text: s.name, id: s._id })),
    ...categoryNames.map((c) => ({ type: "category", text: c.name, id: c._id })),
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
 * Top 10 most searched queries (derived from the Redis analytics list).
 */
const getTrendingSearches = asyncHandler(async (req, res) => {
  const cacheKey = "trending_searches";

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  let raw = [];
  try {
    raw = await redisClient.lRange(ANALYTICS_KEY, 0, ANALYTICS_CAP - 1);
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
