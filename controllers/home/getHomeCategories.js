const Category = require("../../models/categoryModel");
const asyncHandler = require("express-async-handler");
const redisClient = require("../../config/redisClient");

const TTL = 1800; // 30 minutes — categories and their product counts change infrequently

/**
 * @function getHomeCategories
 * @description Returns product categories with their image and the lowest listed
 *              price of any in-stock product in that category ("From ₦X").
 *              Categories with no active products are excluded.
 *              Results are cached in Redis for 30 minutes.
 * @query {number} [limit=12] - Number of categories to return (max 24)
 */
const getHomeCategories = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 24);
  const cacheKey = `home:categories:${limit}`;

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
  const categories = await Category.aggregate([
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "category",
        as: "products",
        pipeline: [
          { $match: { quantity: { $gt: 0 } } },
          { $project: { listedPrice: 1 } },
        ],
      },
    },

    { $match: { "products.0": { $exists: true } } },

    {
      $addFields: {
        productCount: { $size: "$products" },
        fromPrice: { $min: "$products.listedPrice" },
      },
    },

    { $sort: { productCount: -1 } },
    { $limit: limit },

    {
      $project: {
        _id: 1,
        name: 1,
        image: 1,
        fromPrice: 1,
        productCount: 1,
      },
    },
  ]);

  const payload = { success: true, data: categories };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch {
    // Non-fatal
  }

  res.status(200).json(payload);
});

module.exports = getHomeCategories;
