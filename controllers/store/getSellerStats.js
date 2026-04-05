const Product = require("../../models/productModel");
const Store = require("../../models/storeModel");
const Order = require("../../models/orderModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function getSellerStats
 * @description Get detailed statistics for a specific seller
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.storeId - Store ID
 * @returns {Object} - Detailed seller statistics
 */
const getSellerStats = asyncHandler(async (req, res) => {
  const { storeId } = req.params;

  validateMongodbId(storeId);

  try {
    const store = await Store.findById(storeId);
    if (!store) {
      ThrowError("Store not found");
    }

    // Get comprehensive stats
    const [
      products,
      orders,
      ratings,
      recentOrders
    ] = await Promise.all([
      Product.countDocuments({ store: storeId }),
      Order.countDocuments({
        "products.stores": storeId,
        orderStatus: "Delivered",
      }),
      Store.aggregate([
        { $match: { _id: store._id } },
        {
          $lookup: {
            from: "ratings",
            localField: "_id",
            foreignField: "store",
            as: "ratings"
          }
        },
        {
          $project: {
            averageRating: { $avg: "$ratings.rating" },
            totalRatings: { $size: "$ratings" },
            ratingDistribution: {
              $map: {
                input: [1, 2, 3, 4, 5],
                as: "rating",
                in: {
                  rating: "$$rating",
                  count: {
                    $size: {
                      $filter: {
                        input: "$ratings",
                        as: "r",
                        cond: { $eq: ["$$r.rating", "$$rating"] }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      ]),
      Order.find({ "products.stores": storeId })
        .populate("orderedBy", "fullName email mobile")
        .sort({ createdAt: -1 })
        .limit(5)
    ]);

    const stats = ratings[0] || { averageRating: 0, totalRatings: 0, ratingDistribution: [] };

    res.json({
      success: true,
      message: "Seller statistics retrieved successfully",
      data: {
        store: {
          _id: store._id,
          name: store.name,
          address: store.address,
          image: store.image,
          createdAt: store.createdAt
        },
        statistics: {
          totalProducts: products,
          totalOrders: orders,
          averageRating: Math.round(stats.averageRating * 100) / 100,
          totalRatings: stats.totalRatings,
          ratingDistribution: stats.ratingDistribution
        },
        recentOrders: recentOrders.map(order => ({
          _id: order._id,
          customer: {
            name: order.orderedBy?.fullName,
            email: order.orderedBy?.email,
            mobile: order.orderedBy?.mobile,
          },
          status: order.orderStatus,
          totalAmount: order.paymentIntent?.amount,
          createdAt: order.createdAt,
        }))
      }
    });
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getSellerStats;
