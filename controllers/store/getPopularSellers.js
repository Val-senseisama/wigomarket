const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");

/**
 * @function getPopularSellers
 * @description Get popular sellers based on sales, ratings, and activity
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.query.limit=10] - Number of sellers to return
 * @param {string} [req.query.category] - Filter by category
 * @returns {Object} - Array of popular sellers with metrics
 */
const getPopularSellers = asyncHandler(async (req, res) => {
  const { limit = 10, category } = req.query;
  const limitNum = parseInt(limit);

  try {
    // Build aggregation pipeline for popular sellers
    const pipeline = [
      // Match stores that have products
      {
        $match: {
          ...(category && { "products.category": category })
        }
      },
      // Lookup products for each store
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "store",
          as: "products"
        }
      },
      // Lookup orders for each store's products
      {
        $lookup: {
          from: "orders",
          let: { storeId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ["$$storeId", "$products.stores"]
                },
                orderStatus: "Delivered"
              }
            }
          ],
          as: "orders"
        }
      },
      // Lookup ratings for each store
      {
        $lookup: {
          from: "ratings",
          localField: "_id",
          foreignField: "store",
          as: "ratings"
        }
      },
      // Calculate base metrics
      {
        $addFields: {
          totalSales: {
            $sum: {
              $map: {
                input: "$orders",
                as: "order",
                in: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$$order.products",
                          as: "product",
                          cond: { $eq: ["$$product.stores", "$_id"] }
                        }
                      },
                      as: "item",
                      in: { $multiply: ["$$item.count", "$$item.price"] }
                    }
                  }
                }
              }
            }
          },
          totalOrders: { $size: "$orders" },
          totalProducts: { $size: "$products" },
          averageRating: {
            $cond: {
              if: { $gt: [{ $size: "$ratings" }, 0] },
              then: { $avg: "$ratings.rating" },
              else: 0
            }
          },
          totalRatings: { $size: "$ratings" },
        }
      },
      // Popularity score in a separate stage — cannot reference fields computed in the same $addFields
      {
        $addFields: {
          popularityScore: {
            $add: [
              { $multiply: ["$totalSales", 0.4] },
              { $multiply: ["$totalOrders", 10] },
              { $multiply: ["$averageRating", 20] },
              { $multiply: ["$totalProducts", 0.1] }
            ]
          }
        }
      },
      // Sort by popularity score
      { $sort: { popularityScore: -1 } },
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
          totalSales: 1,
          totalOrders: 1,
          totalProducts: 1,
          averageRating: { $round: ["$averageRating", 2] },
          totalRatings: 1,
          popularityScore: { $round: ["$popularityScore", 2] },
          createdAt: 1
        }
      }
    ];

    const popularSellers = await Store.aggregate(pipeline);

    res.json({
      success: true,
      message: "Popular sellers retrieved successfully",
      data: {
        sellers: popularSellers,
        total: popularSellers.length,
        limit: limitNum
      }
    });
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getPopularSellers;
