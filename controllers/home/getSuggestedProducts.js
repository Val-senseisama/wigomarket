const Product = require("../../models/productModel");
const Order = require("../../models/orderModel");
const asyncHandler = require("express-async-handler");
const jwt = require("jsonwebtoken");
const redisClient = require("../../config/redisClient");

const TTL_PERSONALISED = 180;  // 3 minutes — user's taste changes with new orders
const TTL_TRENDING     = 600;  // 10 minutes — trending scores shift slowly

const THIRTY_DAYS_AGO = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

// Project shape shared by both code paths
const PRODUCT_PROJECT = {
  _id: 1,
  title: 1,
  listedPrice: 1,
  image: { $arrayElemAt: ["$images", 0] },
  rating: {
    average: { $round: ["$rating.average", 1] },
    count: "$rating.count",
  },
  "store._id": 1,
  "store.name": 1,
};

/**
 * @function getSuggestedProducts
 * @description Returns products the user is likely to buy.
 *
 *   Authenticated:  Looks at the user's last 10 delivered orders, extracts the
 *                   categories they bought from, then returns highly-rated in-stock
 *                   products from those categories (excluding items they already own).
 *                   Falls back to trending if no order history exists.
 *
 *   Unauthenticated: Returns trending products — ranked by
 *                   (sold × 2 + views × 0.1) in the last 30 days.
 *
 * @query {number} [limit=12] - Number of products to return (max 24)
 * @header {string} [Authorization] - Optional bearer token for personalisation
 */
const getSuggestedProducts = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 12, 24);

  // ── Soft auth: try to extract userId without blocking unauthenticated requests
  let userId = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(
        authHeader.slice(7),
        process.env.JWT_SECRET,
      );
      userId = decoded?.id || decoded?._id || null;
    } catch {
      // Invalid/expired token — treat as unauthenticated
    }
  }

  const cacheKey = userId
    ? `home:suggested:user:${userId}:${limit}`
    : `home:suggested:trending:${limit}`;

  // ── Cache read ────────────────────────────────────────────────────────────
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
  } catch {
    // Redis unavailable — continue to DB
  }

  // ── Personalised path ────────────────────────────────────────────────────────
  if (userId) {
    const recentOrders = await Order.find(
      { orderedBy: userId, orderStatus: "delivered" },
      { "products.product": 1 },
    )
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("products.product", "category");

    const purchasedProductIds = recentOrders.flatMap((o) =>
      o.products.map((p) => p.product?._id).filter(Boolean),
    );
    const purchasedCategories = [
      ...new Set(
        recentOrders.flatMap((o) =>
          o.products.map((p) => p.product?.category?.toString()).filter(Boolean),
        ),
      ),
    ];

    if (purchasedCategories.length > 0) {
      const products = await Product.aggregate([
        {
          $match: {
            category: { $in: purchasedCategories.map((c) => require("mongoose").Types.ObjectId.createFromHexString(c)) },
            _id: { $nin: purchasedProductIds },
            quantity: { $gt: 0 },
          },
        },
        // Rank by rating then recency
        { $sort: { "rating.average": -1, "rating.count": -1, createdAt: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: "stores",
            localField: "store",
            foreignField: "_id",
            as: "store",
            pipeline: [{ $project: { name: 1 } }],
          },
        },
        { $unwind: { path: "$store", preserveNullAndEmpty: true } },
        { $project: PRODUCT_PROJECT },
      ]);

      if (products.length >= Math.ceil(limit / 2)) {
        const payload = { success: true, personalised: true, data: products };
        try {
          await redisClient.setex(cacheKey, TTL_PERSONALISED, JSON.stringify(payload));
        } catch { /* Non-fatal */ }
        return res.status(200).json(payload);
      }
      // Not enough personalised results — fall through to trending
    }
  }

  // ── Trending path (default / fallback) ──────────────────────────────────────
  const products = await Product.aggregate([
    {
      $match: {
        quantity: { $gt: 0 },
        updatedAt: { $gte: THIRTY_DAYS_AGO() },
      },
    },
    {
      $addFields: {
        _trendScore: {
          $add: [
            { $multiply: ["$sold", 2] },
            { $multiply: ["$views", 0.1] },
            { $multiply: ["$rating.average", 5] },
          ],
        },
      },
    },
    { $sort: { _trendScore: -1 } },
    { $limit: limit },
    {
      $lookup: {
        from: "stores",
        localField: "store",
        foreignField: "_id",
        as: "store",
        pipeline: [{ $project: { name: 1 } }],
      },
    },
    { $unwind: { path: "$store", preserveNullAndEmpty: true } },
    { $project: PRODUCT_PROJECT },
  ]);

  const trendingPayload = { success: true, personalised: false, data: products };
  // Trending results can use a longer TTL — use the trending key regardless of
  // whether the personalised path fell through (the personalised key was not
  // written, so next request will re-try personalisation from DB)
  try {
    const trendingKey = `home:suggested:trending:${limit}`;
    await redisClient.setex(trendingKey, TTL_TRENDING, JSON.stringify(trendingPayload));
  } catch { /* Non-fatal */ }

  res.status(200).json(trendingPayload);
});

module.exports = getSuggestedProducts;
