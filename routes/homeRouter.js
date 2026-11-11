const express = require("express");
const {
  getTopShops,
  getHomeCategories,
  getNearbyShops,
  getPopularVendors,
  getSuggestedProducts,
} = require("../controllers/home");
const { optionalAuthMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Shared response-shape descriptions used across multiple endpoints:
//
//  Store card:  { _id, name, image, businessType, city,
//                 rating: { average, count }, averagePrice?, distanceKm?, travelTimeMin? }
//
//  Product card: the buyer card (components/schemas/ProductCard) — the same
//                  object on every buyer product listing.
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
 *         address:
 *           type: string
 *           nullable: true
 *           example: "Fresh Foods Store, Market Square, Benin City"
 *         description:
 *           type: string
 *           nullable: true
 *           example: "High-quality sound systems, mixers and microphones for events and studios."
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
 *               description: >
 *                 Number of product reviews across the shop's unhidden products
 *                 (including out-of-stock ones). This is the "N reviews" figure;
 *                 there is no separate seller rating. GET /api/store/{id}
 *                 returns the same number.
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
 *         isFavourite:
 *           type: boolean
 *           description: >
 *             Whether the signed-in viewer saved this shop (the heart). Send the
 *             bearer token; always false for guests. Toggle with
 *             PUT/DELETE /api/favourites/stores/{storeId}; list with
 *             GET /api/favourites/stores.
 *           example: false
 *     HomePagination:
 *       type: object
 *       description: >
 *         The home section asks for page 1 with the default limit; its "view all"
 *         screen keeps requesting the next page (e.g. limit=20) while `hasMore` is true.
 *       properties:
 *         page:
 *           type: integer
 *           example: 1
 *         limit:
 *           type: integer
 *           example: 20
 *         hasMore:
 *           type: boolean
 *           description: true when another page exists
 *           example: true
 *     ProductCard:
 *       type: object
 *       description: >
 *         The buyer product card — one shape for every buyer product listing:
 *         GET /api/product/get-products (storefront), home suggested-products,
 *         category suggestions, search, saved products and cart lines. Tapping a
 *         card opens GET /api/product/{id} for the full detail. Viewer fields
 *         (isInWishlist, isInCart, cartQuantity) need the bearer token; they are
 *         false/0 for guests.
 *         **Pricing:** show `listedPrice` as the price. When
 *         `listedCompareAtPrice` is not null, show it struck through as the
 *         slashed "was" price, with `discountPercent` as the badge. There is no
 *         `price` field here. `price` is the seller's own figure before the
 *         platform margin and only reaches the shop owner (`mine=true`).
 *       properties:
 *         id:
 *           type: string
 *         title:
 *           type: string
 *           example: "Quartz Wrist Watch"
 *         image:
 *           type: string
 *           format: uri
 *           nullable: true
 *           description: The display image (images[0])
 *         listedPrice:
 *           type: number
 *           description: >
 *             The price the buyer pays (NGN), the main price on the card. Buyer
 *             responses have no `price` field; `price` is the seller's own figure
 *             and is returned to the shop owner only.
 *           example: 10027.61
 *         listedCompareAtPrice:
 *           type: number
 *           nullable: true
 *           description: >
 *             The slashed "was" price (NGN). Render it struck through next to
 *             `listedPrice` only when it is not null; null means no discount.
 *           example: 12053.69
 *         discountPercent:
 *           type: integer
 *           nullable: true
 *           description: Whole-percent saving for a "-17%" badge; null when there is no discount.
 *           example: 17
 *         currency:
 *           type: string
 *           example: "NGN"
 *         priceRange:
 *           type: object
 *           nullable: true
 *           description: Cheapest and dearest version price ("from ₦X") for a product with versions; null otherwise.
 *           properties:
 *             from: { type: number }
 *             to: { type: number }
 *         productType:
 *           type: string
 *           enum: [single, variable]
 *         hasVariants:
 *           type: boolean
 *           description: >
 *             True when the buyer must pick a version (size, colour). Open the
 *             product page instead of adding to cart from the card.
 *         inStock:
 *           type: boolean
 *         stock:
 *           type: integer
 *           description: Units available (total across versions)
 *         rating:
 *           type: object
 *           properties:
 *             average:
 *               type: number
 *               description: Average rating out of 5, one decimal
 *               example: 4.2
 *             count:
 *               type: integer
 *               description: Number of reviews
 *               example: 89
 *         store:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *             name:
 *               type: string
 *         isInWishlist:
 *           type: boolean
 *           description: The viewer saved this product (fill the heart).
 *         isInCart:
 *           type: boolean
 *           description: The viewer has this product in their cart.
 *         cartQuantity:
 *           type: integer
 *           description: Units of this product in the viewer's cart (0 when not in cart).
 */

// ─── 1. Top Shops ─────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/home/top-shops:
 *   get:
 *     summary: Top shops ranked by popularity
 *     description: >
 *       Returns shops sorted by a composite score of completed orders, star rating,
 *       and product count. Store rating is the weighted average of its unhidden
 *       products' ratings (weighted by number of reviews). No authentication needed.
 *
 *       When a shop is tapped, the card already has what the shop popup needs
 *       (name, image, address, description, rating). For "View Products" call
 *       `GET /api/product/get-products?store={_id}` — it returns product cards
 *       for the shop's unhidden, in-stock products (add `status=all` to include
 *       out-of-stock ones). A product card opens `GET /api/product/{id}`.
 *       `GET /api/store/{id}` has the full shop (opening hours, contact,
 *       fulfilment options).
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
 *                             description: Unhidden, in-stock products
 *                             example: 42
 *                           state:
 *                             type: string
 */
router.get("/top-shops", optionalAuthMiddleware, getTopShops);

// ─── 2. Categories ────────────────────────────────────────────────────────────
/**
 * @swagger
 * /api/home/categories:
 *   get:
 *     summary: Product categories with sample price
 *     description: >
 *       Returns categories that have at least one in-stock product a buyer can
 *       see (unhidden, from a public shop). `fromPrice` is the lowest listed
 *       price in that category — display as "From ₦X". `image` is the
 *       category's Cloudinary URL (set via the admin update-category endpoint).

 *       Tapping a card: `GET /api/product/products/suggestions/category/{_id}`
 *       returns that category's product cards (paginated).
 *     tags: [Home]
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [popular, highest_price, lowest_price, latest, alphabetical]
 *           default: popular
 *         description: >
 *           The "Sort By" menu. popular = most products first; highest_price /
 *           lowest_price order by `fromPrice` (the price on the card); latest =
 *           category with the most recently listed product first;
 *           alphabetical = A–Z by name. Unknown values fall back to popular.
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
 *                 sort:
 *                   type: string
 *                   description: The sort actually applied
 *                   example: popular
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
 *                       latestProductAt:
 *                         type: string
 *                         format: date-time
 *                         description: When the newest product in this category was listed
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
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number, for the "view all" screen
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Shops per page
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
 *                 pagination:
 *                   $ref: '#/components/schemas/HomePagination'
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
router.get("/nearby-shops", optionalAuthMiddleware, getNearbyShops);

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
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number, for the "view all" screen
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *         description: Vendors per page
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
 *                 pagination:
 *                   $ref: '#/components/schemas/HomePagination'
 */
router.get("/popular-vendors", optionalAuthMiddleware, getPopularVendors);

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
 *       if fewer than 6 such products exist. The choice is made for the whole
 *       feed, so every page of a "view all" list comes from the same one.
 *
 *       **Trending (no token / fallback):** ranked by `sold × 2 + views × 0.1 +
 *       rating × 5` over the last 30 days.
 *
 *       The `personalised` boolean in the response tells the client which path
 *       was taken so it can label the section accordingly ("For you" vs "Trending").
 *
 *       Send the bearer token whenever the user is signed in: it also sets
 *       `isInWishlist` on each card, so the heart matches the product page.
 *     tags: [Home]
 *     security:
 *       - {}
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number, for the "view all" screen
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *           maximum: 50
 *         description: Products per page
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
 *                 pagination:
 *                   allOf:
 *                     - $ref: '#/components/schemas/HomePagination'
 *                     - type: object
 *                       properties:
 *                         total:
 *                           type: integer
 *                           description: Total products in this feed
 */
router.get("/suggested-products", optionalAuthMiddleware, getSuggestedProducts);

module.exports = router;
