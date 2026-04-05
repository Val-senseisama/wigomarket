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
      // Match active stores
      {
        $match: {
          "location.coordinates": { $exists: true }
        }
      },
      // Add distance calculation using haversine formula
      // GeoJSON location.coordinates = [longitude, latitude]
      {
        $addFields: {
          distance: {
            $multiply: [
              6371, // Earth's radius in kilometers
              {
                $acos: {
                  $add: [
                    {
                      $multiply: [
                        { $sin: { $multiply: [{ $divide: [userLat, 180] }, Math.PI] } },
                        { $sin: { $multiply: [{ $divide: [{ $arrayElemAt: ["$location.coordinates", 1] }, 180] }, Math.PI] } }
                      ]
                    },
                    {
                      $multiply: [
                        { $cos: { $multiply: [{ $divide: [userLat, 180] }, Math.PI] } },
                        { $cos: { $multiply: [{ $divide: [{ $arrayElemAt: ["$location.coordinates", 1] }, 180] }, Math.PI] } },
                        { $cos: { $multiply: [{ $subtract: [{ $divide: [userLng, 180] }, { $divide: [{ $arrayElemAt: ["$location.coordinates", 0] }, 180] }] }, Math.PI] } }
                      ]
                    }
                  ]
                }
              }
            ]
          }
        }
      },
      // Filter by radius
      {
        $match: {
          distance: { $lte: radiusNum }
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
      // Sort by distance
      { $sort: { distance: 1 } },
      // Limit results
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
