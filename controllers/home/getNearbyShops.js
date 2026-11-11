const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const redisClient = require("../../config/redisClient");
const { markFavouriteStores } = require("../../utils/favouriteStores");
const { RATED_PRODUCT_MATCH, ratingFields } = require("../../utils/storeRating");
const { PUBLIC_STORE_MATCH } = require("../../utils/storeVisibility");
const { parsePage } = require("./pagination");

const TTL = 300;                    // 5 minutes — location results go stale quickly
const CITY_SPEED_KM_PER_MIN = 0.5; // 30 km/h

/**
 * Round a coordinate to 2 decimal places (~1.1 km precision).
 * Used to bucket nearby cache keys so users within ~1 km get the same
 * cached result instead of every unique GPS fix being a separate key.
 */
const bucketCoord = (n) => Math.round(parseFloat(n) * 100) / 100;

/**
 * @function getNearbyShops
 * @description Returns active shops within a given radius of the user, sorted by
 *              distance. Uses MongoDB $geoNear with the existing 2dsphere index.
 *              Results are cached per bucketed coordinate for 5 minutes.
 *
 * @query {number} lat           - User latitude  (required)
 * @query {number} lng           - User longitude (required)
 * @query {number} [radius=10]   - Search radius in km (max 50)
 * @query {number} [page=1]      - Page, for the "view all" screen
 * @query {number} [limit=10]    - Results per page (max 50)
 */
const getNearbyShops = asyncHandler(async (req, res) => {
  const { lat, lng, radius = 10 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      message: "lat and lng query parameters are required",
    });
  }

  const userLat  = parseFloat(lat);
  const userLng  = parseFloat(lng);
  const radiusKm = Math.min(parseFloat(radius) || 10, 50);
  const { page, limit: limitNum, skip } = parsePage(req.query, { defaultLimit: 10, maxLimit: 50 });

  if (isNaN(userLat) || isNaN(userLng)) {
    return res.status(400).json({ success: false, message: "lat and lng must be valid numbers" });
  }

  // Bucketed key — users within ~1.1 km share a cache entry
  const cacheKey = `home:nearby:v3:${bucketCoord(userLat)}:${bucketCoord(userLng)}:${radiusKm}:${page}:${limitNum}`;

  // ── Cache read ────────────────────────────────────────────────────────────
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return sendWithFavourites(res, req.user?._id, JSON.parse(cached));
    }
  } catch {
    // Redis unavailable — continue to DB
  }

  // ── DB query ──────────────────────────────────────────────────────────────
  const shops = await Store.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [userLng, userLat] },
        distanceField: "distanceM",
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: {
          ...PUBLIC_STORE_MATCH,
          status: "active",
          "location.coordinates": { $exists: true, $ne: [] },
        },
      },
    },

    // $geoNear already sorts nearest first. One extra row tells us whether
    // there is another page without a second geo query to count.
    { $skip: skip },
    { $limit: limitNum + 1 },

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

    {
      $addFields: {
        distanceKm: { $round: [{ $divide: ["$distanceM", 1000] }, 1] },
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
      $project: {
        _id: 1,
        name: 1,
        image: 1,
        address: 1,
        description: 1,
        businessType: 1,
        city: 1,
        distanceKm: 1,
        travelTimeMin: {
          $ceil: { $divide: ["$distanceKm", CITY_SPEED_KM_PER_MIN] },
        },
        rating: {
          average: { $round: ["$rating.average", 1] },
          count: "$rating.count",
        },
        averagePrice: 1,
      },
    },
  ]);

  const hasMore = shops.length > limitNum;
  const payload = {
    success: true,
    data: shops.slice(0, limitNum),
    pagination: { page, limit: limitNum, hasMore },
    meta: { userLocation: { lat: userLat, lng: userLng }, radiusKm },
  };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch {
    // Non-fatal
  }

  return sendWithFavourites(res, req.user?._id, payload);
});

/**
 * `isFavourite` (the heart) is per viewer: added to a copy of the shared,
 * cached payload on the way out.
 */
const sendWithFavourites = async (res, userId, payload) => {
  const data = (payload.data || []).map((store) => ({ ...store }));
  await markFavouriteStores(userId, data);
  return res.status(200).json({ ...payload, data });
};

module.exports = getNearbyShops;
