const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const redisClient = require("../../config/redisClient");
const { RATED_PRODUCT_MATCH, ratingFields } = require("../../utils/storeRating");

const TTL = 600;                    // 10 minutes — popularity score changes with orders/ratings
const CITY_SPEED_KM_PER_MIN = 0.5; // 30 km/h

/**
 * Round a coordinate to 2 decimal places (~1.1 km precision) for cache bucketing.
 */
const bucketCoord = (n) => Math.round(parseFloat(n) * 100) / 100;

/**
 * @function getPopularVendors
 * @description Returns shops sorted by a composite popularity score
 *              (orders × 10 + rating × 20 + products × 0.5).
 *              If lat/lng are supplied, distanceKm and travelTimeMin are included.
 *              Results are cached in Redis for 10 minutes.
 *
 * @query {number} [lat]         - User latitude  (optional, enables travel time)
 * @query {number} [lng]         - User longitude (optional, enables travel time)
 * @query {number} [limit=10]    - Number of results (max 20)
 */
const getPopularVendors = asyncHandler(async (req, res) => {
  const { lat, lng, limit = 10 } = req.query;
  const limitNum = Math.min(parseInt(limit), 20);
  const hasLocation = lat && lng;
  const userLat = hasLocation ? parseFloat(lat) : null;
  const userLng = hasLocation ? parseFloat(lng) : null;

  // Bucketed key — users within ~1.1 km share a cache entry
  const cacheKey = hasLocation
    ? `home:popular-vendors:v2:${bucketCoord(userLat)}:${bucketCoord(userLng)}:${limitNum}`
    : `home:popular-vendors:v2:global:${limitNum}`;

  // ── Cache read ────────────────────────────────────────────────────────────
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return res.status(200).json(JSON.parse(cached));
    }
  } catch {
    // Redis unavailable — continue to DB
  }

  const pipeline = [];

  // ── Optional: add distance via $geoNear when location is supplied ────────────
  if (hasLocation) {
    pipeline.push({
      $geoNear: {
        near: { type: "Point", coordinates: [userLng, userLat] },
        distanceField: "distanceM",
        spherical: true,
        query: {
          status: "active",
          isVisible: { $ne: false },
          "location.coordinates": { $exists: true, $ne: [] },
        },
      },
    });
    // After $geoNear, also include active stores without a set location
    // (they won't have distanceM, which is fine — travelTimeMin will be omitted)
  } else {
    pipeline.push({ $match: { status: "active", isVisible: { $ne: false } } });
  }

  pipeline.push(
    // Enrich with products
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "store",
        as: "products",
        pipeline: [
          // Unhidden products: all of them feed the rating, in-stock ones the
          // product count and price (utils/storeRating).
          { $match: RATED_PRODUCT_MATCH },
          { $project: { quantity: 1, listedPrice: 1, "rating.average": 1, "rating.count": 1 } },
        ],
      },
    },
    {
      $addFields: {
        _inStock: { $filter: { input: "$products", cond: { $gt: ["$$this.quantity", 0] } } },
      },
    },

    // Count completed orders
    {
      $lookup: {
        from: "orders",
        let: { storeId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $in: ["$$storeId", "$products.store"] },
              orderStatus: "delivered",
            },
          },
          { $count: "n" },
        ],
        as: "_orders",
      },
    },

    {
      $addFields: {
        totalProducts: { $size: "$_inStock" },
        totalOrders: { $ifNull: [{ $arrayElemAt: ["$_orders.n", 0] }, 0] },
        averagePrice: {
          $cond: {
            if: { $gt: [{ $size: "$_inStock" }, 0] },
            then: { $round: [{ $avg: "$_inStock.listedPrice" }, 0] },
            else: null,
          },
        },
        ...ratingFields(),
      },
    },

    {
      $addFields: {
        _score: {
          $add: [
            { $multiply: ["$totalOrders",   10  ] },
            { $multiply: ["$rating.average", 20  ] },
            { $multiply: ["$totalProducts",  0.5 ] },
          ],
        },
      },
    },

    { $sort: { _score: -1 } },
    { $limit: limitNum },
  );

  // ── Project — conditionally include distance/travelTimeMin ──────────────────
  const projectStage = {
    $project: {
      _id: 1,
      name: 1,
      image: 1,
      address: 1,
      description: 1,
      businessType: 1,
      city: 1,
      averagePrice: 1,
      rating: {
        average: { $round: ["$rating.average", 1] },
        count: "$rating.count",
      },
      // Distance fields only when $geoNear ran
      ...(hasLocation && {
        distanceKm: { $round: [{ $divide: ["$distanceM", 1000] }, 1] },
        travelTimeMin: {
          $ceil: {
            $divide: [
              { $round: [{ $divide: ["$distanceM", 1000] }, 1] },
              CITY_SPEED_KM_PER_MIN,
            ],
          },
        },
      }),
    },
  };

  pipeline.push(projectStage);

  const vendors = await Store.aggregate(pipeline);

  const payload = { success: true, data: vendors };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch {
    // Non-fatal
  }

  res.status(200).json(payload);
});

module.exports = getPopularVendors;
