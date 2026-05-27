const express = require("express");
const {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  createProductCategory,
  updateProductCategory,
  getProductsByCategory,
  deleteProductCategory,
  getProductCategories,
  getProducts,
  getPersonalizedSuggestions,
  getTrendingProducts,
  getCategorySuggestions,
  trackProductView,
  getProductReviews,
  createProductReview,
} = require("../controllers/productController");
const { authMiddleware, isSeller, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();
/**
 * @swagger
 * /api/product/create-category:
 *   post:
 *     summary: Create a new product category
 *     description: Create a new product category
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the category
 *     responses:
 *       200:
 *         description: Created category information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
*                   type: string
*       400:
*         description: Category already exists or validation fails
*/
router.post("/create-category", authMiddleware, isAdmin, createProductCategory);
/**
 * @swagger
 * /api/product/update-category:
 *   put:
 *     summary: Update an existing product category
 *     description: Update an existing product category
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
*             required:
*               - id
*               - name
*             properties:
*               id:
*                 type: string
*                 description: Category ID
*               name:
*                 type: string
*                 description: New name for the category
*     responses:
*       200:
*         description: Updated category information
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 name:
*                   type: string
*       400:
*         description: Validation fails or category not found
*/
router.put("/update-category", authMiddleware, isAdmin, updateProductCategory)
/**
 * @swagger
 * /api/product/create-product:
 *   post:
 *     summary: Create a new product
 *     description: |
 *       Creates a new product in the authenticated seller's store.
 *
 *       **Product images must be Cloudinary URLs** — upload them first via
 *       `POST /api/upload/signature` (folder: `products`), then include the
 *       returned `secure_url` values in the `images` array. A maximum of **5**
 *       images are allowed; omit the field entirely if no images are available yet.
 *
 *       The `listedPrice` is calculated automatically:
 *       `listedPrice = price + (price × 2%)` (2 % platform commission).
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - price
 *               - quantity
 *               - category
 *               - brand
 *               - description
 *             properties:
 *               title:
 *                 type: string
 *                 description: Product title
 *                 example: "Bluetooth Speaker"
 *               price:
 *                 type: integer
 *                 description: Seller's price in NGN (integer, > 0)
 *                 example: 15000
 *               quantity:
 *                 type: integer
 *                 description: Stock quantity (integer, ≥ 0)
 *                 example: 50
 *               category:
 *                 type: string
 *                 description: MongoDB ObjectId of the product category
 *                 example: "663f1a2b4e6d1c0012345678"
 *               brand:
 *                 type: string
 *                 description: Brand name
 *                 example: "JBL"
 *               description:
 *                 type: string
 *                 description: Full product description
 *                 example: "Portable wireless speaker with 12-hour battery life."
 *               images:
 *                 type: array
 *                 description: >
 *                   Array of Cloudinary URLs (max 5). Upload each image via
 *                   POST /api/upload/signature (folder: products) first.
 *                 maxItems: 5
 *                 items:
 *                   type: string
 *                   format: uri
 *                   example: "https://res.cloudinary.com/my-cloud/image/upload/v1234/products/speaker.jpg"
 *               specifications:
 *                 type: array
 *                 description: Structured product attributes shown on the detail page.
 *                 items:
 *                   type: object
 *                   required: [key, value]
 *                   properties:
 *                     key:   { type: string, example: "RAM" }
 *                     value: { type: string, example: "8 GB" }
 *               sizes:
 *                 type: array
 *                 description: Available size options (clothing, shoes, etc.)
 *                 items:
 *                   type: string
 *                   example: "M"
 *               colors:
 *                 type: array
 *                 description: Available colour variants.
 *                 items:
 *                   type: object
 *                   required: [name]
 *                   properties:
 *                     name: { type: string, example: "Midnight Black" }
 *                     hex:  { type: string, example: "#1a1a1a" }
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     title: { type: string }
 *                     price: { type: number, description: "Seller's price" }
 *                     listedPrice: { type: number, description: "Price + 2% commission" }
 *                     quantity: { type: number }
 *                     brand: { type: string }
 *                     description: { type: string }
 *                     images: { type: array, items: { type: string } }
 *                     specifications: { type: array }
 *                     sizes: { type: array, items: { type: string } }
 *                     colors: { type: array }
 *                     rating: { type: object, properties: { average: { type: number }, count: { type: integer } } }
 *                     store: { type: object, properties: { name: { type: string }, image: { type: string } } }
 *                     category: { type: object, properties: { name: { type: string } } }
 *       400:
 *         description: Validation error or creation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       401:
 *         description: Unauthorised
 */
router.post("/create-product", authMiddleware, isSeller, createProduct);
/**
 * @swagger
 * /api/product/update/:id:
 *   put:
 *     summary: Update an existing product
 *     description: Update an existing product
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
*             properties:
*               title:
*                 type: string
*                 description: Updated product title
*               price:
*                 type: number
*                 description: Updated product price
*               quantity:
*                 type: number
*                 description: Updated product quantity
*               category:
*                 type: string
*                 description: Updated category ID
*               brand:
*                 type: string
*                 description: Updated product brand
*               description:
*                 type: string
*                 description: Updated product description
*     responses:
*       200:
*         description: Updated product information
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 title:
*                   type: string
*                 price:
*                   type: number
*                 listedPrice:
*                   type: number
*                 quantity:
*                   type: number
*                 category:
*                   type: string
*                 brand:
*                   type: string
*                 description:
*                   type: string
*                 store:
*                   type: object
*                   properties:
*                     name:
*                       type: string
*                     image:
*                       type: string
*       400:
*         description: Validation fails or product not found
*/
router.put("/:id", updateProduct);
/**
 * @swagger
 * /api/product/delete/:id:
 *   delete:
 *     summary: Delete a product
 *     description: Delete a product
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Deletion status message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
*               properties:
*                 message:
*                   type: string
*       400:
*         description: Deletion fails
*/
router.delete("/:id", authMiddleware, isSeller, deleteProduct);
/**
 * @swagger
 * /api/product/get-products:
 *   get:
 *     summary: Get paginated list of all products with store details
 *     description: Get paginated list of all products with store details
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
*           default: 1
*         description: Page number
*       - in: query
*         name: limit
*         schema:
*           type: integer
*           default: 30
*         description: Number of products per page
*     responses:
*       200:
*         description: Paginated list of products with store details
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 data:
*                   type: array
*                   items:
*                     type: object
*                     properties:
*                       title:
*                         type: string
*                       quantity:
*                         type: number
*                       listedPrice:
*                         type: number
*                       image:
*                         type: string
*                       description:
*                         type: string
*                       brand:
*                         type: string
*                       storeDetails:
*                         type: object
*                         properties:
*                           name:
*                             type: string
*                           address:
*                             type: string
*                           mobile:
*                             type: string
*                           image:
*                             type: string
*                 totalProducts:
*                   type: number
*                 totalPages:
*                   type: number
*                 currentPage:
*                   type: number
*       400:
*         description: Retrieval fails
*/
router.get("/get-products", getAllProducts);
/**
 * @swagger
 * /api/product/products/category:
 *   get:
 *     summary: Get products by category
 *     description: Get products by category
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
*           required: true
*         description: Category ID
*     responses:
*       200:
*         description: List of products in the specified category
*         content:
*           application/json:
*             schema:
*               type: array
*               items:
*                 type: object
*                 properties:
*                   _id:
*                     type: string
*                   title:
*                     type: string
*                   price:
*                     type: number
*                   listedPrice:
*                     type: number
*                   quantity:
*                     type: number
*                   category:
*                     type: string
*                   brand:
*                     type: string
*                   description:
*                     type: string
*                   store:
*                     type: object
*                     properties:
*                       name:
*                         type: string
*                       image:
*                         type: string
*       400:
*         description: Retrieval fails
*/
router.get("/products/category", getProductsByCategory); // Get products by category
/**
 * @swagger
 * /api/product/category:
 *   delete:
 *     summary: Delete a product category and its associated products
 *     description: Delete a product category and its associated products
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
*             required:
*               - id
*             properties:
*               id:
*                 type: string
*                 description: Category ID
*     responses:
*       200:
*         description: Deletion status message
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 message:
*                   type: string
*       400:
*         description: Category ID is invalid
*/
router.delete("/category", authMiddleware, isAdmin, deleteProductCategory); // Delete product category
/**
 * @swagger
 * /api/product/categories:
 *   get:
 *     summary: Get all product categories
 *     description: Get all product categories
 *     tags:
 *       - Products
 *     responses:
 *       200:
 *         description: List of all product categories
 *         content:
 *           application/json:
*             schema:
*               type: array
*               items:
*                 type: object
*                 properties:
*                   _id:
*                     type: string
*                   name:
*                     type: string
*       400:
*         description: Retrieval fails
*/
router.get("/categories", getProductCategories); // Get all product categories

// New product endpoints with advanced features
/**
 * @swagger
 * /api/product/products:
 *   get:
 *     summary: Get products with advanced filtering and pagination
 *     description: Get products with advanced filtering, sorting, and pagination
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Category ID filter
 *       - in: query
 *         name: store
 *         schema:
 *           type: string
 *         description: Store ID filter
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *         description: Minimum price filter
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *         description: Maximum price filter
 *       - in: query
 *         name: brand
 *         schema:
 *           type: string
 *         description: Brand filter
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [newest, oldest, price_asc, price_desc, popular, rating, views]
 *           default: newest
 *         description: Sort option
 *       - in: query
 *         name: inStock
 *         schema:
 *           type: boolean
 *           default: true
 *         description: In stock filter
 *     responses:
 *       200:
 *         description: Paginated products with filters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     products:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: number
 *                         totalPages:
 *                           type: number
 *                         totalProducts:
 *                           type: number
 *                         hasNext:
 *                           type: boolean
 *                         hasPrev:
 *                           type: boolean
 *                     filters:
 *                       type: object
 *                       properties:
 *                         categories:
 *                           type: array
 *                         brands:
 *                           type: array
 *                         priceRange:
 *                           type: object
 *                           properties:
 *                             min:
 *                               type: number
 *                             max:
 *                               type: number
 */
router.get("/products", getProducts);

/**
 * @swagger
 * /api/product/products/suggestions/personalized:
 *   get:
 *     summary: Get personalized product suggestions
 *     description: Get personalized product suggestions based on user's history
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of suggestions
 *     responses:
 *       200:
 *         description: Personalized product suggestions
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
 *                     type: object
 */
router.get("/products/suggestions/personalized", authMiddleware, getPersonalizedSuggestions);

/**
 * @swagger
 * /api/product/products/suggestions/trending:
 *   get:
 *     summary: Get trending products
 *     description: Get trending products based on sales and views
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of trending products
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d]
 *           default: 7d
 *         description: Timeframe for trending
 *     responses:
 *       200:
 *         description: Trending products
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
 *                     type: object
 */
router.get("/products/suggestions/trending", getTrendingProducts);

/**
 * @swagger
 * /api/product/products/suggestions/category/{categoryId}:
 *   get:
 *     summary: Get category-based product suggestions
 *     description: Get product suggestions for a specific category
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: categoryId
 *         required: true
 *         schema:
 *           type: string
 *         description: Category ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of suggestions
 *     responses:
 *       200:
 *         description: Category-based product suggestions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     category:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         name:
 *                           type: string
 *                     suggestions:
 *                       type: array
 *                       items:
 *                         type: object
 *       404:
 *         description: Category not found
 */
router.get("/products/suggestions/category/:categoryId", getCategorySuggestions);

/**
 * @swagger
 * /api/product/products/track-view/{id}:
 *   post:
 *     summary: Track product view for analytics
 *     description: Track product view for analytics
 *     tags:
 *       - Products
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: View tracked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.post("/products/track-view/:id", trackProductView);

// ── Per-product routes — MUST be after all named routes to avoid :id ──────
// capturing named paths like /get-products, /categories, etc.

/**
 * @swagger
 * /api/product/{id}/reviews:
 *   get:
 *     summary: Get paginated reviews for a product
 *     description: |
 *       Returns reviews sorted by the chosen strategy, a per-star breakdown
 *       (count of 1★ – 5★), and pagination metadata.
 *       Results are cached for 2 minutes so fresh reviews appear quickly.
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Product ID
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 20 }
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [recent, helpful, highest, lowest]
 *           default: recent
 *         description: |
 *           `recent` — newest first
 *           `helpful` — most upvoted first
 *           `highest` — 5★ first
 *           `lowest`  — 1★ first
 *     responses:
 *       200:
 *         description: Reviews with breakdown and pagination
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reviews:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           _id: { type: string }
 *                           rating: { type: integer, minimum: 1, maximum: 5 }
 *                           comment: { type: string }
 *                           isVerifiedPurchase: { type: boolean }
 *                           helpful: { type: integer }
 *                           createdAt: { type: string, format: date-time }
 *                           user:
 *                             type: object
 *                             properties:
 *                               _id: { type: string }
 *                               firstname: { type: string }
 *                               lastname: { type: string }
 *                               image: { type: string }
 *                     breakdown:
 *                       type: object
 *                       description: Count of reviews per star rating
 *                       properties:
 *                         "1": { type: integer }
 *                         "2": { type: integer }
 *                         "3": { type: integer }
 *                         "4": { type: integer }
 *                         "5": { type: integer }
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage: { type: integer }
 *                         totalPages: { type: integer }
 *                         totalResults: { type: integer }
 *                         hasNext: { type: boolean }
 *                         hasPrev: { type: boolean }
 *       404:
 *         description: Product not found
 */
router.get("/:id/reviews", getProductReviews);

/**
 * @swagger
 * /api/product/{id}/reviews:
 *   post:
 *     summary: Create or update your review for a product
 *     description: |
 *       Requires authentication. The user must have a **Delivered** order
 *       containing this product — unverified reviews are rejected with `403`.
 *
 *       One review per user per product. Calling this again updates the
 *       existing review (rating + comment are replaced).
 *     tags: [Products]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rating]
 *             properties:
 *               rating:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 4
 *               comment:
 *                 type: string
 *                 maxLength: 1000
 *                 example: "Great quality, fast delivery!"
 *     responses:
 *       201:
 *         description: Review created or updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     rating: { type: integer }
 *                     comment: { type: string }
 *                     isVerifiedPurchase: { type: boolean, example: true }
 *                     helpful: { type: integer }
 *                     createdAt: { type: string, format: date-time }
 *       400:
 *         description: Invalid rating value
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *       403:
 *         description: No verified purchase found for this product
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.post("/:id/reviews", authMiddleware, createProductReview);

/**
 * @swagger
 * /api/product/{id}:
 *   get:
 *     summary: Get full product detail
 *     description: |
 *       Returns the complete product record including:
 *       - Core fields: title, price, listedPrice, brand, description, quantity, images
 *       - Structured data: specifications (key/value pairs), available sizes, available colours
 *       - Ratings summary: average and review count (see `GET /{id}/reviews` for the full list)
 *       - Store details: name, image, address
 *       - Category name
 *       - Social proof: sold count, view count
 *
 *       Also increments the product's view counter (fire-and-forget).
 *     tags: [Products]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Product MongoDB ObjectId
 *         example: "664abc123def456789012345"
 *     responses:
 *       200:
 *         description: Full product detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     title: { type: string }
 *                     slug: { type: string }
 *                     description: { type: string }
 *                     price: { type: number, description: "Seller's base price in NGN" }
 *                     listedPrice: { type: number, description: "Price shown to buyers (price + 2% commission)" }
 *                     brand: { type: string }
 *                     quantity: { type: integer }
 *                     sold: { type: integer }
 *                     views: { type: integer }
 *                     images: { type: array, items: { type: string } }
 *                     tags: { type: array, items: { type: string } }
 *                     isFeatured: { type: boolean }
 *                     rating:
 *                       type: object
 *                       properties:
 *                         average: { type: number, example: 4.3 }
 *                         count: { type: integer, example: 12 }
 *                     specifications:
 *                       type: array
 *                       description: Key/value product attributes
 *                       items:
 *                         type: object
 *                         properties:
 *                           key:   { type: string, example: "Storage" }
 *                           value: { type: string, example: "256 GB" }
 *                     sizes:
 *                       type: array
 *                       description: Available size options
 *                       items: { type: string, example: "XL" }
 *                     colors:
 *                       type: array
 *                       description: Available colour variants
 *                       items:
 *                         type: object
 *                         properties:
 *                           name: { type: string, example: "Midnight Black" }
 *                           hex:  { type: string, example: "#1a1a1a" }
 *                     store:
 *                       type: object
 *                       properties:
 *                         _id: { type: string }
 *                         name: { type: string }
 *                         image: { type: string }
 *                         mobile: { type: string }
 *                         address: { type: string }
 *                     category:
 *                       type: object
 *                       properties:
 *                         _id: { type: string }
 *                         name: { type: string }
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get("/:id", getAProduct);

module.exports = router;
