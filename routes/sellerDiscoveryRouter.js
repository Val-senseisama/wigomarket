const express = require("express");
const {
  getPopularSellers,
  getNearbySellers,
  getSellerStats
} = require("../controllers/storeController");

const router = express.Router();

/**
 * @swagger
 * /api/sellers/popular:
 *   get:
 *     summary: Get popular sellers
 *     description: Get popular sellers based on sales, ratings, and activity metrics
 *     tags:
 *       - Seller Discovery
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 10
 *         description: Number of sellers to return
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter sellers by product category
 *         example: "electronics"
 *     responses:
 *       200:
 *         description: Popular sellers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Popular sellers retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     sellers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           address:
 *                             type: object
 *                             properties:
 *                               street:
 *                                 type: string
 *                               city:
 *                                 type: string
 *                               state:
 *                                 type: string
 *                               coordinates:
 *                                 type: object
 *                                 properties:
 *                                   lat:
 *                                     type: number
 *                                   lng:
 *                                     type: number
 *                           storeImage:
 *                             type: string
 *                           storeMobile:
 *                             type: string
 *                           storeEmail:
 *                             type: string
 *                           status:
 *                             type: string
 *                             enum: [active, inactive, suspended]
 *                           totalSales:
 *                             type: number
 *                             description: Total sales amount
 *                           totalOrders:
 *                             type: number
 *                             description: Total number of orders
 *                           totalProducts:
 *                             type: number
 *                             description: Total number of products
 *                           averageRating:
 *                             type: number
 *                             description: Average rating (0-5)
 *                           totalRatings:
 *                             type: number
 *                             description: Total number of ratings
 *                           popularityScore:
 *                             type: number
 *                             description: Calculated popularity score
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                     total:
 *                       type: number
 *                       description: Number of sellers returned
 *                     limit:
 *                       type: number
 *                       description: Maximum number of sellers requested
 */
router.get("/popular", getPopularSellers);

/**
 * @swagger
 * /api/sellers/nearby:
 *   get:
 *     summary: Get nearby sellers
 *     description: Get sellers within a specified radius of the user's location
 *     tags:
 *       - Seller Discovery
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: User's latitude
 *         example: 6.5244
 *       - in: query
 *         name: lng
 *         required: true
 *         schema:
 *           type: number
 *           format: float
 *         description: User's longitude
 *         example: 3.3792
 *       - in: query
 *         name: radius
 *         schema:
 *           type: number
 *           format: float
 *           minimum: 0.1
 *           maximum: 100
 *           default: 10
 *         description: Search radius in kilometers
 *         example: 5.0
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Number of sellers to return
 *         example: 10
 *     responses:
 *       200:
 *         description: Nearby sellers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Nearby sellers retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     sellers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           address:
 *                             type: object
 *                             properties:
 *                               street:
 *                                 type: string
 *                               city:
 *                                 type: string
 *                               state:
 *                                 type: string
 *                               coordinates:
 *                                 type: object
 *                                 properties:
 *                                   lat:
 *                                     type: number
 *                                   lng:
 *                                     type: number
 *                           storeImage:
 *                             type: string
 *                           storeMobile:
 *                             type: string
 *                           storeEmail:
 *                             type: string
 *                           status:
 *                             type: string
 *                             enum: [active, inactive, suspended]
 *                           distance:
 *                             type: number
 *                             description: Distance from user in kilometers
 *                           totalProducts:
 *                             type: number
 *                             description: Total number of products
 *                           averageRating:
 *                             type: number
 *                             description: Average rating (0-5)
 *                           totalRatings:
 *                             type: number
 *                             description: Total number of ratings
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *                     total:
 *                       type: number
 *                       description: Number of sellers found
 *                     userLocation:
 *                       type: object
 *                       properties:
 *                         lat:
 *                           type: number
 *                         lng:
 *                           type: number
 *                     searchRadius:
 *                       type: number
 *                       description: Search radius used in kilometers
 *                     limit:
 *                       type: number
 *                       description: Maximum number of sellers requested
 *       400:
 *         description: Missing or invalid location parameters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Latitude and longitude are required"
 */
router.get("/nearby", getNearbySellers);

/**
 * @swagger
 * /api/sellers/stats/{storeId}:
 *   get:
 *     summary: Get seller statistics
 *     description: Get detailed statistics and metrics for a specific seller
 *     tags:
 *       - Seller Discovery
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema:
 *           type: string
 *         description: Store ID to get statistics for
 *         example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *     responses:
 *       200:
 *         description: Seller statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Seller statistics retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     store:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         address:
 *                           type: object
 *                           properties:
 *                             street:
 *                               type: string
 *                             city:
 *                               type: string
 *                             state:
 *                               type: string
 *                         storeImage:
 *                           type: string
 *                         status:
 *                           type: string
 *                           enum: [active, inactive, suspended]
 *                         createdAt:
 *                           type: string
 *                           format: date-time
 *                     statistics:
 *                       type: object
 *                       properties:
 *                         totalProducts:
 *                           type: number
 *                           description: Total number of products
 *                         totalOrders:
 *                           type: number
 *                           description: Total number of completed orders
 *                         averageRating:
 *                           type: number
 *                           description: Average rating (0-5)
 *                         totalRatings:
 *                           type: number
 *                           description: Total number of ratings
 *                         ratingDistribution:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               rating:
 *                                 type: integer
 *                                 enum: [1, 2, 3, 4, 5]
 *                               count:
 *                                 type: number
 *                                 description: Number of ratings for this score
 *                     recentOrders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           customer:
 *                             type: object
 *                             properties:
 *                               name:
 *                                 type: string
 *                               email:
 *                                 type: string
 *                               mobile:
 *                                 type: string
 *                           status:
 *                             type: string
 *                             enum: [pending, confirmed, shipped, delivered, completed, cancelled]
 *                           totalAmount:
 *                             type: number
 *                           createdAt:
 *                             type: string
 *                             format: date-time
 *       400:
 *         description: Invalid store ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Invalid store ID"
 *       404:
 *         description: Store not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Store not found"
 */
router.get("/stats/:storeId", getSellerStats);

module.exports = router;
