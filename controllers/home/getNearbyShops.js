const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const redisClient = require("../../config/redisClient");

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
 * @query {number} [limit=10]    - Number of results (max 20)
 */
const getNearbyShops = asyncHandler(async (req, res) => {
  const { lat, lng, radius = 10, limit = 10 } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      message: "lat and lng query parameters are required",
    });
  }

  const userLat  = parseFloat(lat);
  const userLng  = parseFloat(lng);
  const radiusKm = Math.min(parseFloat(radius), 50);
  const limitNum = Math.min(parseInt(limit), 20);

  if (isNaN(userLat) || isNaN(userLng)) {
    return res.status(400).json({ success: false, message: "lat and lng must be valid numbers" });
  }

  // Bucketed key — users within ~1.1 km share a cache entry
  const cacheKey = `home:nearby:${bucketCoord(userLat)}:${bucketCoord(userLng)}:${radiusKm}:${limitNum}`;

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
    {
      $geoNear: {
        near: { type: "Point", coordinates: [userLng, userLat] },
        distanceField: "distanceM",
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: {
          status: "active",
          "location.coordinates": { $exists: true, $ne: [] },
        },
      },
    },

    { $limit: limitNum },

    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "store",
        as: "products",
        pipeline: [
          { $match: { quantity: { $gt: 0 } } },
          { $project: { listedPrice: 1, "rating.average": 1, "rating.count": 1 } },
        ],
      },
    },

    {
      $addFields: {
        distanceKm: { $round: [{ $divide: ["$distanceM", 1000] }, 1] },
        averagePrice: {
          $cond: {
            if: { $gt: [{ $size: "$products" }, 0] },
            then: { $round: [{ $avg: "$products.listedPrice" }, 0] },
            else: null,
          },
        },
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
      $project: {
        _id: 1,
        name: 1,
        image: 1,
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

  const payload = {
    success: true,
    data: shops,
    meta: { userLocation: { lat: userLat, lng: userLng }, radiusKm },
  };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch {
    // Non-fatal
  }

  res.status(200).json(payload);
});

module.exports = getNearbyShops;
