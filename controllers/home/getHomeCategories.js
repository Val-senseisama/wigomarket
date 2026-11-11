const Category = require("../../models/categoryModel");
const asyncHandler = require("express-async-handler");
const redisClient = require("../../config/redisClient");
const { categoryCacheVersion } = require("../../utils/categoryCache");
const { visibleStoreProductFilter } = require("../../utils/storeVisibility");

/**
 * The "Sort By" menu on the Product Categories section. Prices are the card's
 * own figure (`fromPrice`, the cheapest in-stock listed price), so "Highest
 * Price" orders the cards by the number printed on them. `_id` breaks ties.
 */
const SORTS = {
  popular: { productCount: -1, _id: 1 },        // default — most products first
  highest_price: { fromPrice: -1, _id: 1 },
  lowest_price: { fromPrice: 1, _id: 1 },
  latest: { latestProductAt: -1, _id: 1 },      // newest product listed first
  alphabetical: { name: 1, _id: 1 },
};
const SORT_ALIASES = {
  price_desc: "highest_price",
  price_asc: "lowest_price",
  newest: "latest",
  latest_product: "latest",
  name: "alphabetical",
  name_asc: "alphabetical",
};
const resolveSort = (raw) => {
  const key = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const name = SORT_ALIASES[key] || key;
  return SORTS[name] ? name : "popular";
};

const TTL = 1800; // 30 minutes — categories and their product counts change infrequently

/**
 * @function getHomeCategories
 * @description Returns product categories with their image and the lowest listed
 *              price of any in-stock product in that category ("From ₦X").
 *              Categories with no active products are excluded.
 *              Results are cached in Redis for 30 minutes; any category
 *              write clears them (utils/categoryCache).
 * @query {number} [limit=12] - Number of categories to return (max 24)
 * @query {string} [sort=popular] - popular | highest_price | lowest_price |
 *                                   latest | alphabetical
 */
const getHomeCategories = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 24);
  const sort = resolveSort(req.query.sort);
  const cacheKey = `home:categories:v${await categoryCacheVersion()}:s2:${sort}:${limit}`;

  // ── Cache read ────────────────────────────────────────────────────────────
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
  } catch {
    // Redis unavailable — continue to DB
  }

  // ── DB query ──────────────────────────────────────────────────────────────
  // Only what a buyer can actually see: unhidden, in-stock products of public shops.
  const shopFilter = await visibleStoreProductFilter();

  const categories = await Category.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "category",
        as: "products",
        pipeline: [
          { $match: { quantity: { $gt: 0 }, status: { $ne: "hidden" }, ...shopFilter } },
          { $project: { listedPrice: 1, createdAt: 1 } },
        ],
      },
    },

    { $match: { "products.0": { $exists: true } } },

    {
      $addFields: {
        productCount: { $size: "$products" },
        fromPrice: { $min: "$products.listedPrice" },
        latestProductAt: { $max: "$products.createdAt" },
      },
    },

    { $sort: SORTS[sort] },
    { $limit: limit },

    {
      $project: {
        _id: 1,
        name: 1,
        image: 1,
        fromPrice: 1,
        productCount: 1,
        latestProductAt: 1,
      },
    },
  ], { collation: { locale: "en", strength: 2 } }); // A–Z ignores case

  const payload = { success: true, sort, data: categories };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch {
    // Non-fatal
  }

  res.status(200).json(payload);
});

module.exports = getHomeCategories;
