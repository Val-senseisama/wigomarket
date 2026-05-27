const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const redisClient = require("../../config/redisClient");

const TTL = 600; // 10 minutes — changes when orders land or products are rated

/**
 * @function getTopShops
 * @description Returns the top shops ranked by a composite popularity score.
 *              Store rating is computed as the weighted average of its products'
 *              embedded rating.average fields (weighted by rating.count).
 *              Results are cached in Redis for 10 minutes.
 * @query {number} [limit=10] - Number of shops to return (max 20)
 */
const getTopShops = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 20);
  const cacheKey = `home:top-shops:${limit}`;

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
  const shops = await Store.aggregate([
    { $match: { status: "active" } },

    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "store",
        as: "products",
        pipeline: [
          { $match: { quantity: { $gt: 0 } } },
          { $project: { "rating.average": 1, "rating.count": 1, sold: 1 } },
        ],
      },
    },

    {
      $lookup: {
        from: "orders",
        let: { storeId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $in: ["$$storeId", "$products.store"] },
              orderStatus: "Delivered",
            },
          },
          { $count: "n" },
        ],
        as: "_orders",
      },
    },

    {
      $addFields: {
        totalProducts: { $size: "$products" },
        totalOrders: { $ifNull: [{ $arrayElemAt: ["$_orders.n", 0] }, 0] },
        "rating.count": { $sum: "$products.rating.count" },
        "rating.average": {
          $cond: {
            if: { $gt: [{ $sum: "$products.rating.count" }, 0] },
            then: {
              $divide: [
                {
                  $sum: {
                    $map: {
                      input: "$products",
                      as: "p",
                      in: { $multiply: ["$$p.rating.average", "$$p.rating.count"] },
                    },
                  },
                },
                { $sum: "$products.rating.count" },
              ],
            },
            else: 0,
          },
        },
      },
    },

    {
      $addFields: {
        _score: {
          $add: [
            { $multiply: ["$totalOrders",    10  ] },
            { $multiply: ["$rating.average", 20  ] },
            { $multiply: ["$totalProducts",   0.5] },
          ],
        },
      },
    },

    { $sort: { _score: -1 } },
    { $limit: limit },

    {
      $project: {
        _id: 1,
        name: 1,
        image: 1,
        businessType: 1,
        city: 1,
        state: 1,
        totalProducts: 1,
        rating: {
          average: { $round: ["$rating.average", 1] },
          count: "$rating.count",
        },
      },
    },
  ]);

  const payload = { success: true, data: shops };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch {
    // Non-fatal
  }

  res.status(200).json(payload);
});

module.exports = getTopShops;
