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
  getSpecSchemas,
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
