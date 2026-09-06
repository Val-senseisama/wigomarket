const express = require("express");
const {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  bulkUpdateProducts,
  createProductCategory,
  updateProductCategory,
  getProductsByCategory,
  deleteProductCategory,
  getProductCategories,
  getSpecSchemas,
  getProducts,
  getPersonalizedSuggestions,
  getTrendingProducts,
  getCategorySuggestions,
  trackProductView,
  getProductReviews,
  createProductReview,
} = require("../controllers/productController");
const {
  authMiddleware,
  optionalAuthMiddleware,
  isSeller,
  isAdmin,
} = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Pagination:
 *       type: object
 *       properties:
 *         total: { type: integer, description: Rows matching the filter, example: 20 }
 *         page: { type: integer, example: 1 }
 *         limit: { type: integer, example: 30 }
 *         pages: { type: integer, description: Total pages at this limit, example: 1 }
 *         hasMore: { type: boolean, example: false }
 *     ProductVariant:
 *       type: object
 *       description: One version of a multiple-version product.
 *       properties:
 *         id: { type: string }
 *         sku: { type: string, nullable: true, example: "WM1201-M-BRN" }
 *         price: { type: number, description: Seller's price (NGN), example: 4900 }
 *         listedPrice: { type: number, nullable: true, description: Buyer-facing price (NGN), example: 5000 }
 *         stock: { type: integer, example: 12 }
 *         sold: { type: integer, example: 9 }
 *         image: { type: string, nullable: true, format: uri }
 *         inStock: { type: boolean }
 *         options:
 *           type: array
 *           description: The option combination this variant is for.
 *           items:
 *             type: object
 *             properties:
 *               name: { type: string, example: "Size" }
 *               value: { type: string, example: "M" }
 *     ProductListItem:
 *       type: object
 *       description: |
 *         A product as rendered on a product-list card. Everything the card
 *         shows is here: image, title, SKU, price, variant count, stock, units
 *         sold, status pill and rating.
 *       properties:
 *         id: { type: string }
 *         title: { type: string, example: "Men's Casual Short Sleeve Shirt" }
 *         slug: { type: string, nullable: true }
 *         sku:
 *           type: string
 *           nullable: true
 *           description: Seller's unit code, unique within the store. Null for products created before SKUs existed. Render as "SKU:&nbsp;#WM1201".
 *           example: "WM1201"
 *         description: { type: string, nullable: true }
 *         brand: { type: string, nullable: true }
 *         price: { type: number, description: What the seller set (NGN), example: 4900 }
 *         listedPrice:
 *           type: number
 *           description: What the buyer pays (NGN) — the figure to show on the card.
 *           example: 5000
 *         currency: { type: string, example: "NGN" }
 *         image: { type: string, nullable: true, format: uri, description: 'images[0] — the display image' }
 *         images: { type: array, items: { type: string, format: uri } }
 *         video: { type: string, nullable: true, format: uri }
 *         stock:
 *           type: integer
 *           description: Units in stock. For a variable product, the total across variants.
 *           example: 50
 *         sold: { type: integer, example: 50 }
 *         views: { type: integer, example: 412 }
 *         productType: { type: string, enum: [single, variable] }
 *         variantCount:
 *           type: integer
 *           description: Render "None" when 0.
 *           example: 6
 *         optionTypes:
 *           type: array
 *           description: The axes a variable product varies along.
 *           items:
 *             type: object
 *             properties:
 *               name: { type: string, example: "Size" }
 *               values: { type: array, items: { type: string } }
 *         priceRange:
 *           type: object
 *           nullable: true
 *           description: Cheapest and dearest variant price — the "from ₦X" figure. Null for a single product.
 *           properties:
 *             from: { type: number, example: 5000 }
 *             to: { type: number, example: 6500 }
 *         variants:
 *           type: array
 *           description: Present only when includeVariants=true or mine=true.
 *           items: { $ref: '#/components/schemas/ProductVariant' }
 *         status:
 *           type: string
 *           enum: [active, hidden]
 *           description: Stored shelf visibility — what the hide/unhide toggle writes.
 *         displayStatus:
 *           type: string
 *           enum: [active, out_of_stock, hidden]
 *           description: The pill to render. Derived — hidden wins, then quantity 0, else active.
 *         statusLabel:
 *           type: string
 *           description: Display text for displayStatus.
 *           example: "Out of stock"
 *         rating:
 *           type: object
 *           properties:
 *             average: { type: number, example: 4.5 }
 *             count: { type: integer, example: 131 }
 *         category:
 *           type: object
 *           nullable: true
 *           properties:
 *             id: { type: string }
 *             name: { type: string, nullable: true, example: "Men's Fashion" }
 *             parent: { type: string, nullable: true }
 *         store:
 *           type: object
 *           nullable: true
 *           properties:
 *             id: { type: string }
 *             name: { type: string, nullable: true }
 *             image: { type: string, nullable: true, format: uri }
 *             address: { type: string, nullable: true }
 *             mobile: { type: string, nullable: true }
 *         specifications:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               key: { type: string, example: "RAM" }
 *               value: { type: string, example: "8 GB" }
 *         sizes: { type: array, items: { type: string } }
 *         colors:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               name: { type: string, example: "Brown" }
 *               hex: { type: string, nullable: true, example: "#5B3A29" }
 *         tags: { type: array, items: { type: string } }
 *         isFeatured: { type: boolean }
 *         availableFor:
 *           type: array
 *           description: How a buyer can receive this product.
 *           items: { type: string, enum: [delivery, pickup] }
 *         availableForLabel:
 *           type: string
 *           nullable: true
 *           description: Ready-made label for the availableFor list.
 *           example: "Delivery & Pick-up"
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     ProductDetail:
 *       allOf:
 *         - $ref: '#/components/schemas/ProductListItem'
 *         - type: object
 *           description: |
 *             Everything the product page renders. The flat card fields above are
 *             all present; the blocks below group them the way the screen is laid
 *             out, so each panel maps to one key. `variants` is always included.
 *           properties:
 *             overview:
 *               type: object
 *               description: The Product Overview panel.
 *               properties:
 *                 name: { type: string, example: "Men's Casual Short Sleeve Shirt" }
 *                 categoryPath:
 *                   type: string
 *                   nullable: true
 *                   description: Breadcrumb under Product Category.
 *                   example: "Fashion > Men's Clothing"
 *                 category:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     id: { type: string }
 *                     name: { type: string, nullable: true }
 *                     parent: { type: string, nullable: true }
 *                     parentCategory:
 *                       type: object
 *                       nullable: true
 *                       properties:
 *                         id: { type: string }
 *                         name: { type: string, nullable: true }
 *                     path: { type: string, nullable: true }
 *                 sku: { type: string, nullable: true, example: "SHRT-MNS-CAS-SS-NAVY-L" }
 *                 dateAdded: { type: string, format: date-time }
 *                 variantCount: { type: integer, example: 6 }
 *                 availableFor: { type: array, items: { type: string, enum: [delivery, pickup] } }
 *                 availableForLabel: { type: string, nullable: true, example: "Delivery & Pick-up" }
 *                 status: { type: string, enum: [active, hidden] }
 *                 displayStatus: { type: string, enum: [active, out_of_stock, hidden] }
 *                 statusLabel: { type: string, example: "Active" }
 *                 productType: { type: string, enum: [single, variable] }
 *                 brand: { type: string, nullable: true }
 *             media:
 *               type: object
 *               description: Every picture ever uploaded for this product, in upload order, plus the video.
 *               properties:
 *                 image: { type: string, nullable: true, format: uri, description: 'images[0] — the main image' }
 *                 images: { type: array, items: { type: string, format: uri } }
 *                 video: { type: string, nullable: true, format: uri }
 *                 imageCount: { type: integer, example: 3 }
 *                 hasVideo: { type: boolean }
 *             inventory:
 *               type: object
 *               description: The Pricing & Inventory panel, including the variants table.
 *               properties:
 *                 price: { type: number, example: 7500 }
 *                 listedPrice: { type: number, example: 7650 }
 *                 currency: { type: string, example: "NGN" }
 *                 priceRange:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     from: { type: number }
 *                     to: { type: number }
 *                 totalStock:
 *                   type: integer
 *                   description: Units ever listed — availableStock + totalSold.
 *                   example: 20
 *                 availableStock: { type: integer, description: Units left on the shelf, example: 8 }
 *                 totalSold: { type: integer, example: 12 }
 *                 lastOrderedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                   description: When this product was last ordered. Owner-only — null for everyone else.
 *                 variants:
 *                   type: array
 *                   description: One row per version. Empty for a single-version product, whose one row is the price/stock above.
 *                   items: { $ref: '#/components/schemas/ProductVariant' }
 *             reviews:
 *               type: object
 *               description: The Rating & Reviews summary. Full list at GET /api/product/{id}/reviews.
 *               properties:
 *                 average: { type: number, example: 4.5 }
 *                 count: { type: integer, example: 10 }
 *                 breakdown:
 *                   type: object
 *                   nullable: true
 *                   description: Reviews per star, for the 5-bar chart.
 *                   properties:
 *                     "1": { type: integer }
 *                     "2": { type: integer }
 *                     "3": { type: integer }
 *                     "4": { type: integer }
 *                     "5": { type: integer }
 */
/**
 * @swagger
 * /api/product/create-category:
 *   post:
 *     summary: Create a product category (top-level or subcategory)
 *     description: |
 *       Categories form a **two-level tree**, which is what the add-product
 *       category picker renders. Omit `parent` for a top-level category
 *       (Fashion, Phones & Accessories, …); pass a top-level category's id to
 *       create a subcategory under it. A third level is rejected.
 *
 *       `specSchema` decides whether the "Product Specification" step appears for
 *       products in this category and which field set it shows. Subcategories
 *       **inherit** it, so tagging "Phones & Accessories" once covers every
 *       subcategory beneath it. Field definitions live at
 *       `GET /api/product/spec-schemas`.
 *
 *       Category names are globally unique, so a subcategory name cannot repeat
 *       under a second parent.
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
 *                 description: Name of the category (globally unique)
 *                 example: "Phone & Tablet"
 *               parent:
 *                 type: string
 *                 nullable: true
 *                 description: Top-level category id. Omit or null for a top-level category.
 *                 example: "663f1a2b4e6d1c0012345678"
 *               specSchema:
 *                 type: string
 *                 nullable: true
 *                 enum: [phone, computer]
 *                 description: >
 *                   Which specification form products in this category must fill
 *                   in. Omit or null for no specification step. Inherited by
 *                   subcategories that do not set their own.
 *               image:
 *                 type: string
 *                 format: uri
 *                 description: "Cloudinary URL — upload via POST /api/upload/signature (folder: categories)"
 *           examples:
 *             topLevel:
 *               summary: Top-level category that drives the phone spec form
 *               value: { name: "Phones & Accessories", specSchema: "phone" }
 *             subcategory:
 *               summary: Subcategory inheriting its parent's spec schema
 *               value: { name: "Phone & Tablet", parent: "663f1a2b4e6d1c0012345678" }
 *     responses:
 *       201:
 *         description: Created category
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:        { type: string }
 *                     name:       { type: string }
 *                     image:      { type: string, nullable: true }
 *                     parent:     { type: string, nullable: true }
 *                     specSchema: { type: string, nullable: true, enum: [phone, computer] }
 *       400:
 *         description: Validation failed, or the chosen parent is itself a subcategory
 *       409:
 *         description: Category already exists
 */
router.post("/create-category", authMiddleware, isAdmin, createProductCategory);
/**
 * @swagger
 * /api/product/update-category:
 *   put:
 *     summary: Update an existing product category
 *     description: |
 *       Partial update — only the fields you send are changed. Send `parent: null`
 *       to promote a subcategory to top level, or a top-level category's id to
 *       move it under that parent.
 *
 *       Two moves are rejected to keep the tree two levels deep: making a
 *       category its own parent, and demoting a category that already has
 *       subcategories.
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
 *               name:
 *                 type: string
 *                 description: New name for the category
 *               parent:
 *                 type: string
 *                 nullable: true
 *                 description: New parent id, or null to promote to top level
 *               specSchema:
 *                 type: string
 *                 nullable: true
 *                 enum: [phone, computer]
 *                 description: Which specification form applies; null to remove the spec step
 *               image:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Updated category
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:        { type: string }
 *                     name:       { type: string }
 *                     image:      { type: string, nullable: true }
 *                     parent:     { type: string, nullable: true }
 *                     specSchema: { type: string, nullable: true }
 *       400:
 *         description: Validation failed, no fields supplied, or an illegal tree move
 *       404:
 *         description: Category not found
 */
router.put("/update-category", authMiddleware, isAdmin, updateProductCategory)
/**
 * @swagger
 * /api/product/create-product:
 *   post:
 *     summary: Create a new product (single or multiple version)
 *     description: |
 *       Creates a product in the authenticated seller's store. This endpoint backs
 *       both branches of the add-product chooser.
 *
 *       ### Choosing a product type
 *
 *       | `productType` | Use when | Price & stock come from |
 *       |---------------|----------|--------------------------|
 *       | `single` (default) | One version, no size/colour variations | Top-level `price` + `quantity` |
 *       | `variable` | Several versions — sizes, colours, types | `variants[]`, one entry per version |
 *
 *       For a `variable` product, **omit** the top-level `price` and `quantity`;
 *       sending them is a 400. They are derived: `price`/`listedPrice` from the
 *       cheapest variant (the "from ₦X" figure) and `quantity` as the sum of all
 *       variant stock. This is what lets search, sorting, cart and checkout treat
 *       both product types identically.
 *
 *       ### The three form steps
 *
 *       **1/ Basic information** — `title`, `category`, `sku`, `quantity`,
 *       `price`, `description`. `brand` is optional (the form does not collect it).
 *
 *       **2/ Images & video** — `images` is **required**: 1-5 Cloudinary URLs,
 *       where `images[0]` is the main display image on the storefront. `video` is
 *       optional. Upload both via `POST /api/upload/signature` (folder:
 *       `products`) first and send the returned `secure_url`s. The MP4 / 60s /
 *       20MB video limits are enforced at upload time by Cloudinary.
 *
 *       **3/ Specification** — only for categories that declare a spec schema
 *       (Phones & Accessories, Computers & Accessories). Call
 *       `GET /api/product/spec-schemas?category={id}` to find out whether this
 *       step applies and to render its fields; a `null` schema means skip it.
 *       When it applies, `specifications` is a **keyed object**, not an array:
 *       `{ "operatingSystem": "Android 13", "ramSize": "6GB" }`. Unknown keys and
 *       out-of-range dropdown values are rejected.
 *
 *       ### Other notes
 *
 *       - `listedPrice = price + (price × 2%)` (platform commission), applied to
 *         the product and to each variant.
 *       - `sku` is optional but must be unique within your store.
 *       - Validation failures return an `errors` array listing every problem at
 *         once, so the form can highlight all bad fields in one pass.
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
 *               - category
 *               - description
 *               - images
 *             properties:
 *               title:
 *                 type: string
 *                 description: Product name
 *                 example: "Bluetooth Speaker"
 *               productType:
 *                 type: string
 *                 enum: [single, variable]
 *                 default: single
 *                 description: Which branch of the add-product chooser this is
 *               sku:
 *                 type: string
 *                 description: Stock keeping unit. Optional, but unique within your store.
 *                 example: "SPK-001"
 *               status:
 *                 type: string
 *                 enum: [active, hidden]
 *                 default: active
 *                 description: >
 *                   Shelf visibility. Send `hidden` to stage a product without it
 *                   appearing on the storefront; it still shows in your own
 *                   product list. Change it later with PUT /api/product/{id}.
 *               availableFor:
 *                 type: array
 *                 default: [delivery]
 *                 description: >
 *                   How a buyer can receive this product — the "Available for"
 *                   line on the product page. Defaults to delivery only.
 *                 items: { type: string, enum: [delivery, pickup] }
 *                 example: ["delivery", "pickup"]
 *               price:
 *                 type: integer
 *                 description: >
 *                   Selling price in NGN (integer, > 0). Required for `single`;
 *                   must be omitted for `variable`.
 *                 example: 15000
 *               quantity:
 *                 type: integer
 *                 description: >
 *                   Stock quantity (integer, ≥ 0). Required for `single`; must be
 *                   omitted for `variable`.
 *                 example: 50
 *               category:
 *                 type: string
 *                 description: MongoDB ObjectId of the product category
 *                 example: "663f1a2b4e6d1c0012345678"
 *               brand:
 *                 type: string
 *                 description: Brand name. Optional — the add-product form does not collect it.
 *                 example: "JBL"
 *               description:
 *                 type: string
 *                 description: Full product description
 *                 example: "Portable wireless speaker with 12-hour battery life."
 *               images:
 *                 type: array
 *                 description: >
 *                   1-5 Cloudinary URLs. images[0] is the main display image on
 *                   the storefront; the rest are extra angles. Upload each via
 *                   POST /api/upload/signature (folder: products) first.
 *                 minItems: 1
 *                 maxItems: 5
 *                 items:
 *                   type: string
 *                   format: uri
 *                   example: "https://res.cloudinary.com/my-cloud/image/upload/v1234/products/speaker.jpg"
 *               video:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *                 description: >
 *                   Optional product video (Cloudinary URL). MP4, max 60 seconds,
 *                   max 20MB — enforced at upload time.
 *               optionTypes:
 *                 type: array
 *                 description: >
 *                   `variable` only. The axes the product varies along, each with
 *                   its allowed values. At most 3 types, 20 values each.
 *                 items:
 *                   type: object
 *                   required: [name, values]
 *                   properties:
 *                     name:   { type: string, example: "Size" }
 *                     values:
 *                       type: array
 *                       items: { type: string }
 *                       example: ["40", "41", "42"]
 *               variants:
 *                 type: array
 *                 description: >
 *                   `variable` only. One entry per version actually for sale — you
 *                   need not list every combination, only the ones you stock. Each
 *                   variant must pin exactly one value for every declared option
 *                   type, and no two variants may cover the same combination.
 *                 maxItems: 100
 *                 items:
 *                   type: object
 *                   required: [price, quantity, options]
 *                   properties:
 *                     sku:      { type: string, example: "SNK-41-BLK" }
 *                     price:    { type: number, example: 45000 }
 *                     quantity: { type: integer, example: 5 }
 *                     image:    { type: string, format: uri, nullable: true }
 *                     options:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [name, value]
 *                         properties:
 *                           name:  { type: string, example: "Size" }
 *                           value: { type: string, example: "41" }
 *               specifications:
 *                 description: >
 *                   For a category with a spec schema: an OBJECT keyed by field id
 *                   (see GET /api/product/spec-schemas). For any other category:
 *                   the legacy free-form array of { key, value } pairs.
 *                 oneOf:
 *                   - type: object
 *                     example:
 *                       operatingSystem: "Android 13"
 *                       ramSize: "6GB"
 *                       romSize: "128GB"
 *                       screenSize: "6.5"
 *                       batteryCapacity: "5000 mAh"
 *                   - type: array
 *                     items:
 *                       type: object
 *                       required: [key, value]
 *                       properties:
 *                         key:   { type: string, example: "Material" }
 *                         value: { type: string, example: "Leather" }
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
 *           examples:
 *             singleVersion:
 *               summary: Single version product (no spec step)
 *               value:
 *                 title: "Wireless Bluetooth Speaker"
 *                 productType: single
 *                 sku: "SPK-001"
 *                 category: "663f1a2b4e6d1c0012345678"
 *                 price: 4500
 *                 quantity: 20
 *                 description: "Portable wireless speaker with 12-hour battery life."
 *                 images:
 *                   - "https://res.cloudinary.com/demo/image/upload/v1/products/main.jpg"
 *                   - "https://res.cloudinary.com/demo/image/upload/v1/products/side.jpg"
 *                 video: "https://res.cloudinary.com/demo/video/upload/v1/products/demo.mp4"
 *             singleVersionPhone:
 *               summary: Single version in a phone category (spec step applies)
 *               value:
 *                 title: "Infinix Hot 40i"
 *                 productType: single
 *                 category: "663f1a2b4e6d1c00123456aa"
 *                 price: 132000
 *                 quantity: 8
 *                 description: "6.6 inch display, 5000mAh battery."
 *                 images: ["https://res.cloudinary.com/demo/image/upload/v1/products/hot40i.jpg"]
 *                 specifications:
 *                   operatingSystem: "Android 13"
 *                   ramSize: "8GB"
 *                   romSize: "256GB"
 *                   screenSize: "6.6"
 *                   batteryCapacity: "5000 mAh"
 *                   networkType: "4G LTE"
 *                   warrantyType: "Seller Warranty"
 *                   warrantyDuration: "1 Year"
 *             multipleVersion:
 *               summary: Multiple version product (sneakers in 3 sizes × 2 colours)
 *               value:
 *                 title: "Court Classic Sneakers"
 *                 productType: variable
 *                 category: "663f1a2b4e6d1c0012345678"
 *                 description: "Low-top leather sneakers."
 *                 images: ["https://res.cloudinary.com/demo/image/upload/v1/products/sneaker.jpg"]
 *                 optionTypes:
 *                   - { name: "Size",  values: ["40", "41", "42"] }
 *                   - { name: "Color", values: ["Black", "White"] }
 *                 variants:
 *                   - sku: "SNK-40-BLK"
 *                     price: 45000
 *                     quantity: 5
 *                     options: [{ name: "Size", value: "40" }, { name: "Color", value: "Black" }]
 *                   - sku: "SNK-41-BLK"
 *                     price: 45000
 *                     quantity: 3
 *                     options: [{ name: "Size", value: "41" }, { name: "Color", value: "Black" }]
 *                   - sku: "SNK-41-WHT"
 *                     price: 47000
 *                     quantity: 2
 *                     options: [{ name: "Size", value: "41" }, { name: "Color", value: "White" }]
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 specSchema:
 *                   type: string
 *                   nullable: true
 *                   description: >
 *                     Which specification schema was applied, or null if the
 *                     category has none. Lets a client that skipped step 3 detect
 *                     that it should have been shown.
 *                   example: phone
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     title: { type: string }
 *                     productType: { type: string, enum: [single, variable] }
 *                     sku: { type: string }
 *                     price:
 *                       type: number
 *                       description: "Seller's price. For a variable product, the cheapest variant."
 *                     listedPrice: { type: number, description: "Price + 2% commission" }
 *                     quantity:
 *                       type: number
 *                       description: "For a variable product, the total across variants."
 *                     brand: { type: string }
 *                     description: { type: string }
 *                     images: { type: array, items: { type: string }, description: "[0] is the main image" }
 *                     video: { type: string, nullable: true }
 *                     specifications:
 *                       type: array
 *                       description: >
 *                         Stored as { key, value } pairs in schema field order,
 *                         where key is the spec field id (e.g. "operatingSystem").
 *                       items:
 *                         type: object
 *                         properties:
 *                           key:   { type: string }
 *                           value: { type: string }
 *                     optionTypes: { type: array, description: "variable products only" }
 *                     variants: { type: array, description: "variable products only" }
 *                     sizes: { type: array, items: { type: string } }
 *                     colors: { type: array }
 *                     rating: { type: object, properties: { average: { type: number }, count: { type: integer } } }
 *                     store: { type: object, properties: { name: { type: string }, image: { type: string } } }
 *                     category: { type: object, properties: { name: { type: string }, specSchema: { type: string } } }
 *       400:
 *         description: |
 *           Validation error. `errors` lists every problem found, so the form can
 *           highlight all bad fields at once.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 message: { type: string }
 *                 errors:
 *                   type: array
 *                   items: { type: string }
 *             examples:
 *               missingSpecs:
 *                 value:
 *                   success: false
 *                   message: "This category requires phone specifications. Fetch the field list from GET /api/product/spec-schemas."
 *                   errors:
 *                     - "Operating System is required"
 *                     - "RAM Size (Memory) is required"
 *               badVariants:
 *                 value:
 *                   success: false
 *                   message: "Invalid product versions"
 *                   errors:
 *                     - "Variant 2: 'Red' is not a declared value of option type 'Color'"
 *                     - "Variant 3: missing a value for option type(s): Size"
 *       401:
 *         description: Unauthorised
 *       404:
 *         description: Category not found
 */
router.post("/create-product", authMiddleware, isSeller, createProduct);

/**
 * @swagger
 * /api/product/spec-schemas:
 *   get:
 *     summary: Category specification field sets for the add-product form
 *     description: |
 *       Returns the "Product Specification" field definitions — label, input type,
 *       whether it is required, placeholder, and the allowed values for dropdowns.
 *       The add-product specification step (3/3) renders itself from this, so a new
 *       RAM size or warranty term ships without an app release.
 *
 *       Pass `?category={id}` to ask about one category. A `specSchema` of `null`
 *       means that category has **no** specification step — go straight from images
 *       to publishing. Subcategories inherit their parent's schema, so tagging
 *       "Phones & Accessories" covers everything beneath it.
 *
 *       Warranty fields are appended to every schema and are always optional.
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Category id. Omit to return every schema.
 *     responses:
 *       200:
 *         description: Specification schema(s)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     specSchemas:
 *                       type: array
 *                       description: Present when no category filter was given
 *                       items: { $ref: '#/components/schemas/ProductSpecSchema' }
 *                     category:
 *                       type: object
 *                       description: Present when ?category was given
 *                       properties:
 *                         _id:  { type: string }
 *                         name: { type: string }
 *                     specSchema:
 *                       nullable: true
 *                       description: Present when ?category was given; null means no spec step
 *                       allOf:
 *                         - $ref: '#/components/schemas/ProductSpecSchema'
 *             examples:
 *               forPhoneCategory:
 *                 value:
 *                   success: true
 *                   data:
 *                     category: { _id: "663f1a2b4e6d1c00123456aa", name: "Phone & Tablet" }
 *                     specSchema:
 *                       key: phone
 *                       label: "Phone & Tablet"
 *                       fields:
 *                         - id: operatingSystem
 *                           label: "Operating System"
 *                           type: text
 *                           required: true
 *                           placeholder: "e.g. Android 13, iOS 17"
 *                         - id: ramSize
 *                           label: "RAM Size (Memory)"
 *                           type: select
 *                           required: true
 *                           placeholder: "e.g. 6GB"
 *                           options: ["1GB", "2GB", "3GB", "4GB", "6GB", "8GB", "12GB", "16GB", "18GB", "24GB"]
 *               noSpecStep:
 *                 summary: A category with no specification step
 *                 value:
 *                   success: true
 *                   data:
 *                     category: { _id: "663f1a2b4e6d1c0012345678", name: "Fashion" }
 *                     specSchema: null
 *       404:
 *         description: Category not found
 *
 * components:
 *   schemas:
 *     ProductSpecSchema:
 *       type: object
 *       properties:
 *         key:
 *           type: string
 *           enum: [phone, computer]
 *         label: { type: string }
 *         description: { type: string }
 *         fields:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 description: The key to send in the `specifications` object
 *                 example: operatingSystem
 *               label: { type: string, example: "Operating System" }
 *               type:
 *                 type: string
 *                 enum: [text, select]
 *                 description: Render a free-text input or a dropdown
 *               required:
 *                 type: boolean
 *                 description: Whether create/update rejects the product without it
 *               placeholder: { type: string }
 *               options:
 *                 type: array
 *                 description: Allowed values — present for `select` fields only
 *                 items: { type: string }
 */
router.get("/spec-schemas", getSpecSchemas);
/**
 * @swagger
 * /api/product/{id}:
 *   put:
 *     summary: Update a product in your own store
 *     description: |
 *       Partial update — only the fields you send change. Seller-only, and
 *       scoped to the caller's own store: a product id belonging to another
 *       store returns 404, not 403.
 *
 *       Internal and derived fields (`sold`, `views`, `store`, `rating`, `slug`,
 *       `listedPrice`) are not accepted; `slug` and `listedPrice` are recomputed
 *       when `title` or `price` changes. `productType` cannot change after
 *       creation — existing carts and orders are priced against the shape the
 *       product had when they were made.
 *
 *       **Hiding a product** — send `{ "status": "hidden" }` to take it off the
 *       storefront, `{ "status": "active" }` to put it back. "Out of stock" is
 *       not a value here: it follows from `quantity` and is reported as
 *       `displayStatus` on the listing endpoints.
 *
 *       **Single-version products** are repriced and restocked with `price` and
 *       `quantity`.
 *
 *       **Multiple-version products** are repriced and restocked through
 *       `variants` — the "Edit Variant" table. Send the full list you want to
 *       keep: rows you leave out are removed, and top-level `price`,
 *       `listedPrice` and `quantity` are re-derived from what you send (cheapest
 *       variant, and the total stock). Each variant's `sold` is carried over by
 *       its option combination, so repricing never erases sales history.
 *       Sending `price` or `quantity` directly on a variable product is a 400.
 *       `optionTypes` may be sent alone to add an option value, or together with
 *       `variants`; every variant must pin one allowed value per option type.
 *
 *       **Removing the video** — send `"video": null`. **Clearing the SKU** —
 *       send `"sku": null`. A SKU must stay unique within your store.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
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
 *             properties:
 *               title: { type: string }
 *               price: { type: number, description: "Seller's price (NGN); listedPrice is recomputed from it" }
 *               quantity: { type: integer, minimum: 0 }
 *               category: { type: string, description: Category id }
 *               brand: { type: string }
 *               description: { type: string }
 *               images: { type: array, items: { type: string, format: uri }, description: Cloudinary URLs, 1-5 }
 *               video:
 *                 type: string
 *                 format: uri
 *                 nullable: true
 *                 description: Cloudinary URL, or null to remove the video
 *               sku:
 *                 type: string
 *                 nullable: true
 *                 description: Unique within your store; null clears it
 *               availableFor:
 *                 type: array
 *                 description: How a buyer can receive this product
 *                 items: { type: string, enum: [delivery, pickup] }
 *               optionTypes:
 *                 type: array
 *                 description: Multiple-version products only — the axes the product varies along
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string, example: "Size" }
 *                     values: { type: array, items: { type: string } }
 *               variants:
 *                 type: array
 *                 description: Multiple-version products only — the full list of versions to keep
 *                 items:
 *                   type: object
 *                   required: [price, quantity, options]
 *                   properties:
 *                     sku: { type: string }
 *                     price: { type: number, description: "Seller's price (NGN)" }
 *                     quantity: { type: integer, minimum: 0 }
 *                     image: { type: string, format: uri, nullable: true }
 *                     options:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name: { type: string, example: "Size" }
 *                           value: { type: string, example: "M" }
 *               status:
 *                 type: string
 *                 enum: [active, hidden]
 *                 description: Shelf visibility — the hide/unhide toggle on the product card
 *               tags: { type: array, items: { type: string } }
 *               isFeatured: { type: boolean }
 *               sizes: { type: array, items: { type: string } }
 *               colors:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     name: { type: string }
 *                     hex: { type: string, nullable: true }
 *               specifications:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     key: { type: string }
 *                     value: { type: string }
 *           example:
 *             status: "hidden"
 *     responses:
 *       200:
 *         description: |
 *           The updated product, in the same shape `GET /api/product/{id}`
 *           returns — so the page can re-render from the response without a
 *           second call.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data: { $ref: '#/components/schemas/ProductDetail' }
 *       400:
 *         description: Validation failed, or no updatable field supplied
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Not a seller
 *       404:
 *         description: Product not found in your store
 */
router.put("/:id", authMiddleware, isSeller, updateProduct);
/**
 * @swagger
 * /api/product/{id}:
 *   delete:
 *     summary: Delete one of your own products
 *     description: |
 *       Permanently deletes the product, its reviews, and every cart and
 *       wishlist row pointing at it. Seller-only and scoped to the caller's own
 *       store: another store's product id returns 404, not 403.
 *
 *       Deletion cannot be undone. To take a product off the storefront while
 *       keeping it (and its sales history), hide it instead:
 *       `PUT /api/product/{id}` with `{ "status": "hidden" }`.
 *
 *       Past orders are untouched — they carry their own copy of the line item.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Product ID
 *     responses:
 *       200:
 *         description: The product was deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string }
 *                     title: { type: string }
 *             example:
 *               success: true
 *               message: "Product deleted successfully"
 *               data:
 *                 id: "66f1a2b3c4d5e6f708192a3b"
 *                 title: "Men's Casual Short Sleeve Shirt"
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Not a seller
 *       404:
 *         description: Product not found in your store
 */
router.delete("/:id", authMiddleware, isSeller, deleteProduct);
/**
 * @swagger
 * /api/product/bulk:
 *   post:
 *     summary: Hide, unhide or delete several of your products at once
 *     description: |
 *       The "Bulk action" control above the product list. Send the ids the
 *       seller ticked and the action to apply.
 *
 *       - `hide`   — take them off the storefront (`status: "hidden"`)
 *       - `unhide` — put them back (`status: "active"`)
 *       - `delete` — permanent, and also removes their reviews and any cart or
 *         wishlist rows pointing at them
 *
 *       Only products in the caller's own store are touched. Ids belonging to
 *       another store, or already deleted, come back in `skipped` rather than
 *       failing the batch — one stale row in the grid cannot block the rest.
 *       Every id must be a valid ObjectId, and at most 100 per call.
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
 *             required: [action, ids]
 *             properties:
 *               action:
 *                 type: string
 *                 enum: [hide, unhide, delete]
 *               ids:
 *                 type: array
 *                 maxItems: 100
 *                 items: { type: string }
 *           example:
 *             action: "hide"
 *             ids:
 *               - "66f1a2b3c4d5e6f708192a3b"
 *               - "66f1a2b3c4d5e6f708192a3c"
 *     responses:
 *       200:
 *         description: The action was applied
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     action: { type: string, enum: [hide, unhide, delete] }
 *                     matched: { type: integer, description: Ids found in your store }
 *                     affected: { type: integer, description: Products now in the requested state }
 *                     skipped:
 *                       type: array
 *                       description: Ids that are not in your store, or no longer exist.
 *                       items: { type: string }
 *             example:
 *               success: true
 *               message: "2 products hidden"
 *               data:
 *                 action: "hide"
 *                 matched: 2
 *                 affected: 2
 *                 skipped: []
 *       400:
 *         description: Unknown action, empty ids, more than 100 ids, or a malformed id
 *       401:
 *         description: Missing or invalid token
 *       403:
 *         description: Not a seller
 *       404:
 *         description: None of those products are in your store
 */
router.post("/bulk", authMiddleware, isSeller, bulkUpdateProducts);
/**
 * @swagger
 * /api/product/get-products:
 *   get:
 *     summary: List products (storefront grid and the seller's own product list)
 *     description: |
 *       One listing endpoint for two callers.
 *
 *       **Public / storefront** — no token, or any token without `mine=true`.
 *       Returns active, in-stock products only; hidden products are never
 *       included, whoever asks.
 *
 *       **Seller's own product list** — send the seller's Bearer token with
 *       `mine=true`. Scopes to the caller's store and includes hidden and
 *       out-of-stock products, embeds each product's variants, and returns
 *       `counts` for the Status filter chips. This is what the "Product List"
 *       grid uses.
 *
 *       Every item is the same card shape: image, title, SKU, price, variant
 *       count, stock, units sold, status pill and rating.
 *
 *       **Status is partly derived.** `status` on the document is only
 *       `active` or `hidden`; the pill to render is `displayStatus`, which is
 *       `hidden` when the seller hid it, `out_of_stock` when quantity is 0, and
 *       `active` otherwise. To hide or unhide, `PUT /api/product/{id}` with
 *       `{ "status": "hidden" | "active" }`.
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *       - {}
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches product name or SKU (case-insensitive, partial). A leading "#" is ignored.
 *         example: WM1201
 *       - in: query
 *         name: mine
 *         schema: { type: boolean, default: false }
 *         description: Scope to the authenticated seller's own store, including hidden and out-of-stock products.
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, out_of_stock, hidden, all]
 *         description: |
 *           Status filter. Defaults to `active` for public callers and `all` for `mine=true`.
 *           `hidden` returns nothing for a public caller.
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: >
 *           Category id — the Category filter dropdown. Picking a top-level
 *           category also returns products filed under its subcategories.
 *       - in: query
 *         name: store
 *         schema: { type: string }
 *         description: Store id — a public store page. Ignored when `mine=true`.
 *       - in: query
 *         name: brand
 *         schema: { type: string }
 *         description: Brand, partial match
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *         description: Minimum listed price
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *         description: Maximum listed price
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [newest, oldest, price_asc, price_desc, best_selling, top_rated, title_asc, title_desc, stock_asc, stock_desc]
 *           default: newest
 *       - in: query
 *         name: includeVariants
 *         schema: { type: boolean, default: false }
 *         description: Embed the full variant list on each product. Always on when `mine=true`.
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 30, maximum: 100 }
 *     responses:
 *       200:
 *         description: Paginated product cards
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ProductListItem' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *                 counts:
 *                   type: object
 *                   nullable: true
 *                   description: Per-status totals for the filter chips. Null on unscoped public listings.
 *                   properties:
 *                     all: { type: integer }
 *                     active: { type: integer }
 *                     out_of_stock: { type: integer }
 *                     hidden: { type: integer }
 *                 appliedStatus:
 *                   type: string
 *                   description: The status filter actually applied, including the default.
 *                 totalProducts: { type: integer, deprecated: true }
 *                 totalPages: { type: integer, deprecated: true }
 *                 currentPage: { type: integer, deprecated: true }
 *             example:
 *               success: true
 *               data:
 *                 - id: "66f1a2b3c4d5e6f708192a3b"
 *                   title: "Men's Casual Short Sleeve Shirt"
 *                   slug: "mens-casual-short-sleeve-shirt"
 *                   sku: "WM1201"
 *                   description: "Breathable cotton shirt, regular fit."
 *                   brand: "Wigo Basics"
 *                   price: 4900
 *                   listedPrice: 5000
 *                   currency: "NGN"
 *                   image: "https://res.cloudinary.com/demo/image/upload/v1/products/shirt-1.jpg"
 *                   images:
 *                     - "https://res.cloudinary.com/demo/image/upload/v1/products/shirt-1.jpg"
 *                     - "https://res.cloudinary.com/demo/image/upload/v1/products/shirt-2.jpg"
 *                   video: null
 *                   stock: 50
 *                   sold: 50
 *                   views: 412
 *                   productType: "variable"
 *                   variantCount: 6
 *                   optionTypes:
 *                     - name: "Size"
 *                       values: ["S", "M", "L"]
 *                     - name: "Color"
 *                       values: ["Brown", "Black"]
 *                   priceRange: { from: 5000, to: 6500 }
 *                   variants:
 *                     - id: "66f1a2b3c4d5e6f708192a4c"
 *                       sku: "WM1201-M-BRN"
 *                       price: 4900
 *                       listedPrice: 5000
 *                       stock: 12
 *                       sold: 9
 *                       image: "https://res.cloudinary.com/demo/image/upload/v1/products/shirt-brown.jpg"
 *                       options:
 *                         - { name: "Size", value: "M" }
 *                         - { name: "Color", value: "Brown" }
 *                       inStock: true
 *                   status: "active"
 *                   displayStatus: "active"
 *                   statusLabel: "Active"
 *                   rating: { average: 4.5, count: 131 }
 *                   category: { id: "66e0…", name: "Men's Fashion", parent: "66d9…" }
 *                   store: { id: "66c1…", name: "Wigo Threads", image: null, address: "12 Allen Ave, Ikeja", mobile: "2348012345678" }
 *                   specifications: []
 *                   sizes: []
 *                   colors: []
 *                   tags: []
 *                   isFeatured: false
 *                   createdAt: "2026-08-01T09:14:22.113Z"
 *                   updatedAt: "2026-08-20T16:02:41.900Z"
 *                 - id: "66f1a2b3c4d5e6f708192a3c"
 *                   title: "Sprinkle Birthday cake"
 *                   slug: "sprinkle-birthday-cake"
 *                   sku: "WM1202"
 *                   description: "Vanilla sponge with buttercream and sprinkles."
 *                   brand: null
 *                   price: 4900
 *                   listedPrice: 5000
 *                   currency: "NGN"
 *                   image: "https://res.cloudinary.com/demo/image/upload/v1/products/cake.jpg"
 *                   images: ["https://res.cloudinary.com/demo/image/upload/v1/products/cake.jpg"]
 *                   video: null
 *                   stock: 0
 *                   sold: 50
 *                   views: 88
 *                   productType: "single"
 *                   variantCount: 0
 *                   optionTypes: []
 *                   priceRange: null
 *                   variants: []
 *                   status: "active"
 *                   displayStatus: "out_of_stock"
 *                   statusLabel: "Out of stock"
 *                   rating: { average: 4.5, count: 131 }
 *                   category: { id: "66e1…", name: "Cakes", parent: "66d8…" }
 *                   store: { id: "66c1…", name: "Wigo Threads", image: null, address: "12 Allen Ave, Ikeja", mobile: "2348012345678" }
 *                   specifications: []
 *                   sizes: []
 *                   colors: []
 *                   tags: []
 *                   isFeatured: false
 *                   createdAt: "2026-07-28T11:02:10.000Z"
 *                   updatedAt: "2026-08-19T08:31:00.000Z"
 *               pagination:
 *                 total: 20
 *                 page: 1
 *                 limit: 30
 *                 pages: 1
 *                 hasMore: false
 *               counts: { all: 20, active: 16, out_of_stock: 3, hidden: 1 }
 *               appliedStatus: "all"
 *               totalProducts: 20
 *               totalPages: 1
 *               currentPage: 1
 *       401:
 *         description: "`mine=true` without a valid token"
 *       404:
 *         description: "`mine=true` for an account with no store"
 */
router.get("/get-products", optionalAuthMiddleware, getAllProducts);
/**
 * @swagger
 * /api/product/products/category:
 *   get:
 *     summary: Get products by category
 *     description: |
 *       Public listing for one category — products the seller has hidden are
 *       never returned. Note this reads `categoryId` from the **request body**;
 *       `GET /api/product/get-products?category=<id>` is the query-param
 *       listing, and it also covers a category's subcategories.
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
 *     summary: Get all product categories (flat, or nested for the picker)
 *     description: |
 *       Defaults to the flat array it has always returned, so existing clients are
 *       unaffected.
 *
 *       Pass **`?tree=true`** for the two-level shape the add-product category
 *       picker needs: top-level categories each with a `children` array. In the
 *       tree form `specSchema` is already **resolved** — a subcategory shows its
 *       parent's schema when it has none of its own — so the picker can decide
 *       whether to show the specification step from the picked category alone,
 *       with no second request. `null` means no specification step.
 *
 *       `orphaned` appears only if some subcategory's parent has been deleted.
 *       Those would otherwise vanish from the picker, leaving their products
 *       uneditable.
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: tree
 *         schema: { type: boolean, default: false }
 *         description: Return the nested two-level shape instead of a flat array
 *     responses:
 *       200:
 *         description: Categories, flat or nested depending on `tree`
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   description: Default flat list
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:        { type: string }
 *                       name:       { type: string }
 *                       image:      { type: string, nullable: true }
 *                       parent:     { type: string, nullable: true }
 *                       specSchema: { type: string, nullable: true }
 *                 - type: object
 *                   description: With ?tree=true
 *                   properties:
 *                     success: { type: boolean }
 *                     data:
 *                       type: object
 *                       properties:
 *                         categories:
 *                           type: array
 *                           items: { $ref: '#/components/schemas/CategoryNode' }
 *                         orphaned:
 *                           type: array
 *                           description: Subcategories whose parent no longer exists
 *                           items: { type: object }
 *             examples:
 *               tree:
 *                 summary: ?tree=true
 *                 value:
 *                   success: true
 *                   data:
 *                     categories:
 *                       - _id: "663f1a2b4e6d1c0012345601"
 *                         name: "Fashion"
 *                         image: null
 *                         specSchema: null
 *                         children:
 *                           - { _id: "663f1a2b4e6d1c0012345611", name: "Men's Fashion", image: null, specSchema: null, children: [] }
 *                           - { _id: "663f1a2b4e6d1c0012345612", name: "Women's Fashion", image: null, specSchema: null, children: [] }
 *                       - _id: "663f1a2b4e6d1c0012345602"
 *                         name: "Phones & Accessories"
 *                         image: null
 *                         specSchema: phone
 *                         children:
 *                           - { _id: "663f1a2b4e6d1c0012345621", name: "Phone & Tablet", image: null, specSchema: phone, children: [] }
 *       400:
 *         description: Retrieval fails
 *
 * components:
 *   schemas:
 *     CategoryNode:
 *       type: object
 *       properties:
 *         _id:   { type: string }
 *         name:  { type: string }
 *         image: { type: string, nullable: true }
 *         specSchema:
 *           type: string
 *           nullable: true
 *           enum: [phone, computer]
 *           description: Resolved — inherited from the parent when not set on the category itself
 *         children:
 *           type: array
 *           description: Always empty on a subcategory (the tree is two levels deep)
 *           items: { $ref: '#/components/schemas/CategoryNode' }
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
 *       The Rating & Reviews panel: a `summary` (average, review count and the
 *       per-star breakdown for the 5 bars), one page of reviews, and pagination
 *       for the arrows.
 *
 *       `sort` is the "Sort by" dropdown. `rating` narrows the list to one star
 *       rating — clicking a bar in the breakdown — while `summary.breakdown`
 *       stays across every review, so the bars do not collapse when a filter is
 *       applied.
 *
 *       `limit` is the page size: 5 and 10 are the usual choices, 20 the
 *       maximum. Results are cached for 2 minutes and the cache is retired the
 *       moment a review is posted.
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
 *       - in: query
 *         name: rating
 *         schema: { type: integer, minimum: 1, maximum: 5 }
 *         description: Show only reviews with this star rating. Omit for all.
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
 *                     summary:
 *                       type: object
 *                       description: Everything the rating header needs — the average, the review count and the bars.
 *                       properties:
 *                         average: { type: number, example: 4.5 }
 *                         count: { type: integer, example: 10 }
 *                         breakdown:
 *                           type: object
 *                           description: Reviews per star, across all reviews — unaffected by the rating filter.
 *                           properties:
 *                             "1": { type: integer, example: 0 }
 *                             "2": { type: integer, example: 1 }
 *                             "3": { type: integer, example: 1 }
 *                             "4": { type: integer, example: 2 }
 *                             "5": { type: integer, example: 6 }
 *                     appliedFilters:
 *                       type: object
 *                       description: Echo of the filters in force, so the client renders its controls without re-deriving defaults.
 *                       properties:
 *                         sort: { type: string, example: "recent" }
 *                         rating: { type: integer, nullable: true, example: null }
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
 *                       description: Same as summary.breakdown — kept for clients written against the original shape.
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
 *       400:
 *         description: rating must be an integer between 1 and 5
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
 *       Everything the product page renders, in one call:
 *
 *       - **overview** — name, category breadcrumb ("Fashion > Men's Clothing"),
 *         SKU, date added, variant count, what it is available for
 *         (Delivery / Pick-up), and the status pill
 *       - **media** — every picture ever uploaded, in upload order, plus the
 *         product video
 *       - **description** — the full product description (also at the top level)
 *       - **inventory** — price, total stock, available stock, total sold, last
 *         ordered, and the variants table for a multiple-version product
 *       - **reviews** — average, review count and the per-star breakdown for the
 *         Rating & Reviews panel; the reviews themselves are paginated at
 *         `GET /api/product/{id}/reviews`
 *
 *       Every flat product-card field is present at the top level too, so a
 *       client already parsing a listing response can reuse it unchanged.
 *
 *       For a **single-version** product `inventory.variants` is empty and the
 *       one row is `inventory.price` / `inventory.availableStock`. For a
 *       **multiple-version** product those top-level figures are derived — the
 *       cheapest variant's price and the total stock across variants — and the
 *       table lives in `inventory.variants`.
 *
 *       Sending the seller's Bearer token adds `isOwner: true` and
 *       `inventory.lastOrderedAt` (sales data, not exposed to buyers), and
 *       suppresses the view-count increment so a seller opening their own
 *       product does not inflate its views.
 *
 *       **Hidden products** (`status: "hidden"`) return 404 to everyone except
 *       the seller who owns them — send the seller's token to load one into an
 *       edit screen. The token is optional everywhere else.
 *     tags: [Products]
 *     security:
 *       - bearerAuth: []
 *       - {}
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
 *                 isOwner:
 *                   type: boolean
 *                   description: True when the caller owns this product — render the Edit / Delete / Hide controls.
 *                 data: { $ref: '#/components/schemas/ProductDetail' }
 *             example:
 *               success: true
 *               isOwner: true
 *               data:
 *                 id: "66f1a2b3c4d5e6f708192a3b"
 *                 title: "Men's Casual Short Sleeve Shirt"
 *                 sku: "SHRT-MNS-CAS-SS-NAVY-L"
 *                 description: "A lightweight, breathable casual shirt perfect for everyday wear. Made with 100% cotton and tailored for comfort."
 *                 price: 7500
 *                 listedPrice: 7650
 *                 currency: "NGN"
 *                 image: "https://res.cloudinary.com/wigo/image/upload/shirt-black.jpg"
 *                 images:
 *                   - "https://res.cloudinary.com/wigo/image/upload/shirt-black.jpg"
 *                   - "https://res.cloudinary.com/wigo/image/upload/shirt-white.jpg"
 *                   - "https://res.cloudinary.com/wigo/image/upload/shirt-navy.jpg"
 *                 video: "https://res.cloudinary.com/wigo/video/upload/shirt-demo.mp4"
 *                 stock: 8
 *                 sold: 12
 *                 views: 412
 *                 productType: "variable"
 *                 variantCount: 4
 *                 status: "active"
 *                 displayStatus: "active"
 *                 statusLabel: "Active"
 *                 availableFor: ["delivery", "pickup"]
 *                 availableForLabel: "Delivery & Pick-up"
 *                 rating: { average: 4.5, count: 10 }
 *                 overview:
 *                   name: "Men's Casual Short Sleeve Shirt"
 *                   categoryPath: "Fashion > Men's Clothing"
 *                   category:
 *                     id: "66f1a2b3c4d5e6f708192a11"
 *                     name: "Men's Clothing"
 *                     parent: "66f1a2b3c4d5e6f708192a10"
 *                     parentCategory: { id: "66f1a2b3c4d5e6f708192a10", name: "Fashion" }
 *                     path: "Fashion > Men's Clothing"
 *                   sku: "SHRT-MNS-CAS-SS-NAVY-L"
 *                   dateAdded: "2026-06-03T09:12:44.000Z"
 *                   variantCount: 4
 *                   availableFor: ["delivery", "pickup"]
 *                   availableForLabel: "Delivery & Pick-up"
 *                   status: "active"
 *                   displayStatus: "active"
 *                   statusLabel: "Active"
 *                   productType: "variable"
 *                   brand: "Wigo Basics"
 *                 media:
 *                   image: "https://res.cloudinary.com/wigo/image/upload/shirt-black.jpg"
 *                   imageCount: 3
 *                   hasVideo: true
 *                 inventory:
 *                   price: 7500
 *                   listedPrice: 7650
 *                   currency: "NGN"
 *                   priceRange: { from: 7650, to: 8160 }
 *                   totalStock: 20
 *                   availableStock: 8
 *                   totalSold: 12
 *                   lastOrderedAt: "2026-06-04T18:22:10.000Z"
 *                   variants:
 *                     - id: "66f1a2b3c4d5e6f708192b01"
 *                       sku: "Shirt-BL-M-01"
 *                       price: 7500
 *                       listedPrice: 7650
 *                       stock: 2
 *                       sold: 10
 *                       inStock: true
 *                       options:
 *                         - { name: "Color", value: "Black" }
 *                         - { name: "Size",  value: "M" }
 *                     - id: "66f1a2b3c4d5e6f708192b02"
 *                       sku: "Shirt-BL-L-01"
 *                       price: 8000
 *                       listedPrice: 8160
 *                       stock: 6
 *                       sold: 2
 *                       inStock: true
 *                       options:
 *                         - { name: "Color", value: "Black" }
 *                         - { name: "Size",  value: "L" }
 *                 reviews:
 *                   average: 4.5
 *                   count: 10
 *                   breakdown: { "1": 0, "2": 1, "3": 1, "4": 2, "5": 6 }
 *       404:
 *         description: Product not found, or hidden and you do not own it
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 */
router.get("/:id", optionalAuthMiddleware, getAProduct);

module.exports = router;
