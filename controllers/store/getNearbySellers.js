const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function getNearbySellers
 * @description Get sellers near a specific location
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} req.query.lat - Latitude of user location
 * @param {number} req.query.lng - Longitude of user location
 * @param {number} [req.query.radius=10] - Search radius in kilometers
 * @param {number} [req.query.limit=20] - Number of sellers to return
 * @returns {Object} - Array of nearby sellers with distances
 */
const getNearbySellers = asyncHandler(async (req, res) => {
  const { lat, lng, radius = 10, limit = 20 } = req.query;
  const radiusNum = parseFloat(radius);
  const limitNum = parseInt(limit);

  if (!lat || !lng) {
    ThrowError("Latitude and longitude are required");
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);

  try {
    // Build aggregation pipeline for nearby sellers
    const pipeline = [
      // Geospatial search against the `location` 2dsphere index.
      // $geoNear must be the first stage, returns results already sorted
      // nearest-first, and reports distance in metres — scaled to km here.
      {
        $geoNear: {
          near: { type: "Point", coordinates: [userLng, userLat] },
          distanceField: "distance",
          maxDistance: radiusNum * 1000, // km → metres
          distanceMultiplier: 0.001, // metres → km
          query: { "location.coordinates": { $exists: true } },
          spherical: true,
        }
      },
      // Lookup products count
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "store",
          as: "products"
        }
      },
      // Lookup ratings
      {
        $lookup: {
          from: "ratings",
          localField: "_id",
          foreignField: "store",
          as: "ratings"
        }
      },
      // Add metrics
      {
        $addFields: {
          totalProducts: { $size: "$products" },
          averageRating: {
            $cond: {
              if: { $gt: [{ $size: "$ratings" }, 0] },
              then: { $avg: "$ratings.rating" },
              else: 0
            }
          },
          totalRatings: { $size: "$ratings" }
        }
      },
      // $geoNear already returns results sorted nearest-first
      { $limit: limitNum },
      // Project final fields
      {
        $project: {
          _id: 1,
          name: 1,
          address: 1,
          image: 1,
          mobile: 1,
          email: 1,
          distance: { $round: ["$distance", 2] },
          totalProducts: 1,
          averageRating: { $round: ["$averageRating", 2] },
          totalRatings: 1,
          createdAt: 1
        }
      }
    ];

    const nearbySellers = await Store.aggregate(pipeline);

    res.json({
      success: true,
      message: "Nearby sellers retrieved successfully",
      data: {
        sellers: nearbySellers,
        total: nearbySellers.length,
        userLocation: {
          lat: userLat,
          lng: userLng
        },
        searchRadius: radiusNum,
        limit: limitNum
      }
    });
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getNearbySellers;
