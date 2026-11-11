const mongoose = require("mongoose");
const Product = require("../../models/productModel");
const Order = require("../../models/orderModel");
const asyncHandler = require("express-async-handler");
const redisClient = require("../../config/redisClient");
const { visibleStoreProductFilter } = require("../../utils/storeVisibility");
const { serializeBuyerCard, BUYER_CARD_PROJECTION } = require("../../utils/productSerializer");
const { markViewerState } = require("../../utils/viewerProductState");
const { parsePage } = require("./pagination");

const TTL_PERSONALISED = 180;  // 3 minutes — user's taste changes with new orders
const TTL_TRENDING     = 600;  // 10 minutes — trending scores shift slowly

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

// Below this many matching products, personalisation is not worth showing and
// the feed is trending instead. Decided on the whole candidate set, not on one
// page, so every page of a "view all" list comes from the same feed.
const MIN_PERSONALISED = 6;

const THIRTY_DAYS_AGO = () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

// Rows carry exactly what the buyer product card needs (the same card as
// get-products); `price` is fetched only as a fallback and never returned.
const PRODUCT_PROJECT = BUYER_CARD_PROJECTION;

const STORE_LOOKUP = [
  {
    $lookup: {
      from: "stores",
      localField: "store",
      foreignField: "_id",
      as: "store",
      pipeline: [{ $project: { name: 1 } }],
    },
  },
  { $unwind: { path: "$store", preserveNullAndEmptyArrays: true } },
];

const toCard = (row) => serializeBuyerCard(row);

/**
 * Match for the personalised feed: in-stock products from the categories of
 * the user's last 10 delivered orders, excluding what they already bought.
 * Null when the user has no usable history.
 */
const personalisedMatch = async (userId, shopFilter) => {
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
  if (!purchasedCategories.length) return null;

  return {
    category: { $in: purchasedCategories.map((c) => new mongoose.Types.ObjectId(c)) },
    _id: { $nin: purchasedProductIds },
    quantity: { $gt: 0 },
    status: { $ne: "hidden" },
    ...shopFilter,
  };
};

/**
 * @function getSuggestedProducts
 * @description Returns products the user is likely to buy, paginated for the
 *   home section and its "view all" screen.
 *
 *   Signed in: in-stock products from the categories of the user's last 10
 *   delivered orders, best rated first, excluding items they already bought —
 *   when at least MIN_PERSONALISED such products exist. Otherwise, and for
 *   guests, trending products ranked by (sold × 2 + views × 0.1 + rating × 5)
 *   among products updated in the last 30 days.
 *
 *   Cards are the buyer product card shared with get-products. The viewer
 *   fields (isInWishlist, isInCart, cartQuantity) are applied after the cache.
 *
 * @query {number} [page=1]
 * @query {number} [limit=12] - Max 50
 */
const getSuggestedProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query, { defaultLimit: DEFAULT_LIMIT, maxLimit: MAX_LIMIT });
  const userId = req.user?._id ? String(req.user._id) : null;

  const userKey = userId ? `home:suggested:v3:user:${userId}:${page}:${limit}` : null;
  const trendingKey = `home:suggested:v3:trending:${page}:${limit}`;

  const respond = async (payload) => {
    // Clone so the per-viewer flag never lands in a cached object.
    const data = payload.data.map((p) => ({ ...p }));
    await markViewerState(userId, data);
    return res.status(200).json({ ...payload, data });
  };

  // ── Cache read ────────────────────────────────────────────────────────────
  // A signed-in user's key holds whichever feed they were given, so a user
  // without enough history is served the trending page from their own key.
  try {
    const cached = await redisClient.get(userKey || trendingKey);
    if (cached) return respond(JSON.parse(cached));
  } catch {
    // Redis unavailable — continue to DB
  }

  // Excludes products of hidden or suspended shops from both paths.
  const shopFilter = await visibleStoreProductFilter();

  // ── Personalised path ────────────────────────────────────────────────────
  if (userId) {
    const match = await personalisedMatch(userId, shopFilter);
    const total = match ? await Product.countDocuments(match) : 0;

    if (total >= MIN_PERSONALISED) {
      const products = await Product.aggregate([
        { $match: match },
        // Rank by rating then recency; _id breaks ties so pages never overlap.
        { $sort: { "rating.average": -1, "rating.count": -1, createdAt: -1, _id: 1 } },
        { $skip: skip },
        { $limit: limit },
        ...STORE_LOOKUP,
        { $project: PRODUCT_PROJECT },
      ]);

      const payload = {
        success: true,
        personalised: true,
        data: products.map(toCard),
        pagination: { page, limit, total, hasMore: skip + products.length < total },
      };
      try {
        await redisClient.setex(userKey, TTL_PERSONALISED, JSON.stringify(payload));
      } catch { /* Non-fatal */ }
      return respond(payload);
    }
  }

  // ── Trending path (default / fallback) ──────────────────────────────────────
  const trendingMatch = {
    quantity: { $gt: 0 },
    status: { $ne: "hidden" },
    ...shopFilter,
    updatedAt: { $gte: THIRTY_DAYS_AGO() },
  };

  const [products, total] = await Promise.all([
    Product.aggregate([
      { $match: trendingMatch },
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
      { $sort: { _trendScore: -1, _id: 1 } },
      { $skip: skip },
      { $limit: limit },
      ...STORE_LOOKUP,
      { $project: PRODUCT_PROJECT },
    ]),
    Product.countDocuments(trendingMatch),
  ]);

  const payload = {
    success: true,
    personalised: false,
    data: products.map(toCard),
    pagination: { page, limit, total, hasMore: skip + products.length < total },
  };

  try {
    await redisClient.setex(trendingKey, TTL_TRENDING, JSON.stringify(payload));
    // Pin this user to trending too, so their next page does not re-run the
    // history lookup and flip feeds mid-scroll.
    if (userKey) await redisClient.setex(userKey, TTL_PERSONALISED, JSON.stringify(payload));
  } catch { /* Non-fatal */ }

  return respond(payload);
});

module.exports = getSuggestedProducts;
