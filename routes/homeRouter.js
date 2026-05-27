const express = require("express");
const {
  getTopShops,
  getHomeCategories,
  getNearbyShops,
  getPopularVendors,
  getSuggestedProducts,
} = require("../controllers/home");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Shared response-shape descriptions used across multiple endpoints:
//
//  Store card:  { _id, name, image, businessType, city,
//                 rating: { average, count }, averagePrice?, distanceKm?, travelTimeMin? }
//
//  Product card: { _id, title, listedPrice, image, rating: { average, count },
//                  store: { _id, name } }
//
//  All ratings are out of 5.  `count` is the total number of raters.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   name: Home
 *   description: Home-screen feed endpoints — no authentication required
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     StoreCard:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *         image:
 *           type: string
 *           format: uri
 *         businessType:
 *           type: string
 *           example: "Retail"
 *         city:
 *           type: string
 *           example: "Lagos"
 *         rating:
 *           type: object
 *           properties:
 *             average:
 *               type: number
 *               description: Average rating out of 5
 *               example: 4.3
 *             count:
 *               type: integer
 *               description: Total number of raters
 *               example: 128
 *         averagePrice:
 *           type: integer
 *           description: Average listed price across the store's products (NGN)
 *           example: 3200
 *         distanceKm:
 *           type: number
 *           description: Distance from the user in km (only present when lat/lng supplied)
 *           example: 2.4
 *         travelTimeMin:
 *           type: integer
 *           description: Estimated travel time in minutes at 30 km/h (only when lat/lng supplied)
 *           example: 5
 *     ProductCard:
 *       type: object
 *       properties:
 *         _id:
 *           type: string
 *         title:
 *           type: string
 *           example: "Bluetooth Speaker"
 *         listedPrice:
 *           type: integer
 *           description: Buyer-facing price in NGN
 *           example: 15300
 *         image:
 *           type: string
 *           format: uri
 *           description: First product image URL (null if none uploaded)
 *         rating:
 *           type: object
 *           properties:
 *             average:
 *               type: number
 *               description: Average rating out of 5
 *               example: 4.2
 *             count:
 *               type: integer
 *               description: Total number of raters
 *               example: 89
 *         store:
 *           type: object
 *           properties:
 *             _id:
 *               type: string
 *             name:
 *               type: string
 */

// ─── 1. Top Shops ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/home/top-shops:
 *   get:
 *     summary: Top shops ranked by popularity
 *     description: >
 *       Returns shops sorted by a composite score of completed orders, star rating,
 *       and product count. Store rating is the weighted average of all its products'
 *       individual ratings (weighted by number of raters). No authentication needed.
 *     tags: [Home]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 20
 *         description: Number of shops to return
 *     responses:
 *       200:
 *         description: Top shops list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/StoreCard'
 *                       - type: object
 *                         properties:
 *                           totalProducts:
 *                             type: integer
 *                             example: 42
 */
router.get("/top-shops", getTopShops);

// ─── 2. Categories ────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/home/categories:
 *   get:
 *     summary: Product categories with sample price
 *     description: >
 *       Returns categories that have at least one in-stock product, sorted by
 *       how many products they contain. `fromPrice` is the lowest listed price
 *       in that category — display as "From ₦X". `image` is the category's
 *       Cloudinary URL (set via the admin update-category endpoint).
 *     tags: [Home]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *           maximum: 24
 *         description: Number of categories to return
 *     responses:
 *       200:
 *         description: Category list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       name:
 *                         type: string
 *                         example: "Electronics"
 *                       image:
 *                         type: string
 *                         format: uri
 *                         nullable: true
 *                       fromPrice:
 *                         type: integer
 *                         description: Lowest listed price in this category (NGN)
 *                         example: 1500
 *                       productCount:
 *                         type: integer
 *                         example: 143
 */
router.get("/categories", getHomeCategories);

// ─── 3. Nearby Shops ─────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/home/nearby-shops:
 *   get:
 *     summary: Active shops near the user's location
 *     description: >
 *       Returns shops within `radius` km of the supplied coordinates, sorted by
 *       distance. Uses the MongoDB 2dsphere index for efficient geospatial lookup.
 *       `travelTimeMin` is estimated at 30 km/h (city average) and is intended as
 *       a UI hint, not a navigation estimate. `averagePrice` is the mean listed
 *       price across all in-stock products in the store.
 *     tags: [Home]
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema:
 *           type: number
 *         description: User latitude
 *         example: 6.5244
 *       - in: query
 *         name: lng
 *         required: true
 *         schema:
 *           type: number
 *         description: User longitude
 *         example: 3.3792
 *       - in: query
 *         name: radius
 *         schema:
 *           type: number
 *           default: 10
 *           maximum: 50
 *         description: Search radius in km
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 20
 *         description: Number of shops to return
 *     responses:
 *       200:
 *         description: Nearby shops
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StoreCard'
 *                 meta:
 *                   type: object
 *                   properties:
 *                     userLocation:
 *                       type: object
 *                       properties:
 *                         lat:
 *                           type: number
 *                         lng:
 *                           type: number
 *                     radiusKm:
 *                       type: number
 *       400:
 *         description: lat and lng are required or are not valid numbers
 */
router.get("/nearby-shops", getNearbyShops);

// ─── 4. Popular Vendors ───────────────────────────────────────────────────────
/**
 * @swagger
 * /api/home/popular-vendors:
 *   get:
 *     summary: Top vendors by popularity score
 *     description: >
 *       Returns shops sorted by a composite popularity score (orders × 10 +
 *       rating × 20 + product count × 0.5). If `lat` and `lng` are supplied,
 *       `distanceKm` and `travelTimeMin` are included in each result (same
 *       30 km/h estimate as nearby-shops). Omit lat/lng for a global list.
 *     tags: [Home]
 *     parameters:
 *       - in: query
 *         name: lat
 *         schema:
 *           type: number
 *         description: User latitude (optional — enables distance + travel time)
 *         example: 6.5244
 *       - in: query
 *         name: lng
 *         schema:
 *           type: number
 *         description: User longitude (optional — enables distance + travel time)
 *         example: 3.3792
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 20
 *         description: Number of vendors to return
 *     responses:
 *       200:
 *         description: Popular vendors list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/StoreCard'
 */
router.get("/popular-vendors", getPopularVendors);

// ─── 5. Suggested Products ────────────────────────────────────────────────────
/**
 * @swagger
 * /api/home/suggested-products:
 *   get:
 *     summary: Products you might like
 *     description: >
 *       Returns product cards personalised to the user when a valid bearer token
 *       is present, or trending products when called without authentication.
 *
 *       **Personalised (token present):** finds the categories from the user's last
 *       10 delivered orders, returns highly-rated in-stock products from those
 *       categories that the user has not already purchased. Falls back to trending
 *       if purchase history is empty or too narrow.
 *
 *       **Trending (no token / fallback):** ranked by `sold × 2 + views × 0.1 +
 *       rating × 5` over the last 30 days.
 *
 *       The `personalised` boolean in the response tells the client which path
 *       was taken so it can label the section accordingly ("For you" vs "Trending").
 *     tags: [Home]
 *     security:
 *       - {}
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *           maximum: 24
 *         description: Number of products to return
 *     responses:
 *       200:
 *         description: Product suggestions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 personalised:
 *                   type: boolean
 *                   description: true if results were tailored to the user, false if trending
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ProductCard'
 */
router.get("/suggested-products", getSuggestedProducts);

module.exports = router;
