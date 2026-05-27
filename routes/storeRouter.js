const express = require("express");
const {
  search,
  getAStore,
  getAllStores,
  createStore,
  getMyStore,
  updateBankDetails,
  getPopularSellers,
  getNearbySellers,
} = require("../controllers/store");
const { updateStoreLocation } = require("../controllers/storeController");
const { authMiddleware, isSeller } = require("../middleware/authMiddleware");

const router = express.Router();
/**
 * @swagger
 * /api/store/create:
 *   post:
 *     summary: Create a new store
 *     description: |
 *       Creates a new store for the authenticated seller.
 *       A confirmation email is sent via background queue on success.
 *
 *       **Image fields must be Cloudinary URLs** — upload them first via
 *       `POST /api/upload/signature`, then pass the returned `secure_url` here.
 *
 *       | Field | Cloudinary folder |
 *       |-------|-------------------|
 *       | `storeImage` | `stores` |
 *       | `ownerNIN` | `store-nin` |
 *     tags:
 *       - Stores
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
 *               - address
 *               - storeMobile
 *               - storeEmail
 *               - storeImage
 *               - ownerNIN
 *               - businessType
 *               - city
 *               - state
 *             properties:
 *               name:
 *                 type: string
 *                 description: Unique store name
 *                 example: "Adaeze Electronics"
 *               address:
 *                 type: string
 *                 description: Full street address of the store
 *                 example: "12 Broad Street, Lagos Island"
 *               storeMobile:
 *                 type: string
 *                 description: Store contact phone number
 *                 example: "08012345678"
 *               storeEmail:
 *                 type: string
 *                 format: email
 *                 description: Store contact email address
 *                 example: "shop@adaeze.com"
 *               storeImage:
 *                 type: string
 *                 format: uri
 *                 description: >
 *                   Cloudinary URL of the store photo. Upload the image via
 *                   POST /api/upload/signature (folder: stores) first.
 *                 example: "https://res.cloudinary.com/my-cloud/image/upload/v1234/stores/banner.jpg"
 *               ownerNIN:
 *                 type: string
 *                 format: uri
 *                 description: >
 *                   Cloudinary URL of the owner's NIN document image. Upload via
 *                   POST /api/upload/signature (folder: store-nin) first.
 *                 example: "https://res.cloudinary.com/my-cloud/image/upload/v1234/store-nin/nin.jpg"
 *               businessType:
 *                 type: string
 *                 description: Type of business (e.g. Retail, Wholesale, Services)
 *                 example: "Retail"
 *               city:
 *                 type: string
 *                 example: "Lagos"
 *               state:
 *                 type: string
 *                 example: "Lagos State"
 *               description:
 *                 type: string
 *                 description: Short store description (optional)
 *                 example: "We sell quality electronics at affordable prices."
 *     responses:
 *       201:
 *         description: Store created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     mobile:
 *                       type: string
 *                     email:
 *                       type: string
 *                     image:
 *                       type: string
 *                     ownerNIN:
 *                       type: string
 *                     businessType:
 *                       type: string
 *                     city:
 *                       type: string
 *                     state:
 *                       type: string
 *                     owner:
 *                       type: string
 *                     address:
 *                       type: string
 *       400:
 *         description: Validation error, store name taken, or user already has a store
 *       401:
 *         description: Unauthorised
 */
router.post("/create", authMiddleware, createStore);
/**
 * @swagger
 * /api/store/my-store:
 *   get:
 *     summary: Get the current user's store
 *     description: Get the current user's store
 *     tags:
 *       - Stores
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's store information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 email:
 *                   type: string
 *                 owner:
 *                   type: string
 *                 address:
 *                   type: string
 *       400:
 *         description: Store not found or retrieval fails
 */
router.get("/my-store", authMiddleware, isSeller, getMyStore);

/**
 * @swagger
 * /api/store/update-location:
 *   put:
 *     summary: Update store location (geocode address or pin drop)
 *     description: Geocodes a text address OR accepts raw lat/lng from a map pin drop. Updates the store's GeoJSON location for geospatial queries and map display.
 *     tags:
 *       - Stores
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               address:
 *                 type: string
 *                 description: Full text address to geocode (mutually exclusive with lat/lng)
 *               lat:
 *                 type: number
 *                 description: Direct latitude from map pin drop
 *               lng:
 *                 type: number
 *                 description: Direct longitude from map pin drop
 *     responses:
 *       200:
 *         description: Updated location data
 *       400:
 *         description: Validation error or geocoding failed
 */
router.put("/update-location", authMiddleware, isSeller, updateStoreLocation);

/**
 * @swagger
 * /api/store/nearby:
 *   get:
 *     summary: Get stores near a user's coordinates
 *     tags: [Stores]
 *     parameters:
 *       - in: query
 *         name: lat
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: lng
 *         required: true
 *         schema:
 *           type: number
 *       - in: query
 *         name: radius
 *         schema:
 *           type: number
 *           default: 10
 *         description: Search radius in km
 *     responses:
 *       200:
 *         description: List of nearby stores with location data
 */
router.get("/popular", getPopularSellers);
router.get("/nearby", getNearbySellers);
/**
 * @swagger
 * /api/store/bank-details:
 *   post:
 *     summary: Update store's bank details and create subaccount
 *     description: Update store's bank details and create subaccount
 *     tags:
 *       - Stores
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bankName
 *               - accountNumber
 *               - accountName
 *               - bankCode
 *             properties:
 *               bankName:
 *                 type: string
 *               accountNumber:
 *                 type: string
 *               accountName:
 *                 type: string
 *               bankCode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated store information with bank details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 email:
 *                   type: string
 *                 owner:
 *                   type: string
 *                 address:
 *                   type: string
 *                 bankDetails:
 *                   type: object
 *                   properties:
 *                     accountName:
 *                       type: string
 *                     accountNumber:
 *                       type: string
 *                     bankCode:
 *                       type: string
 *                     bankName:
 *                       type: string
 *                 subAccountDetails:
 *                   type: object
 *       400:
 *         description: Validation fails, store not found, or bank details update fails
 */
router.post("/bank-details", authMiddleware, isSeller, updateBankDetails);
/**
 * @swagger
 * /api/store/all:
 *   get:
 *     summary: Get all stores with selected fields
 *     description: Get all stores with selected fields
 *     tags:
 *       - Stores
 *     responses:
 *       200:
 *         description: Array of store objects with selected fields
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
 *                   image:
 *                     type: string
 *                   email:
 *                     type: string
 *                   mobile:
 *                     type: string
 *                   address:
 *                     type: string
 *       400:
 *         description: Retrieval fails
 */
router.get("/all", getAllStores);
/**
 * @swagger
 * /:id:
 *   get:
 *     summary: Get a single store by ID
 *     description: Get a single store by ID
 *     tags:
 *       - Stores
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Store ID
 *     responses:
 *       200:
 *         description: Store information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 email:
 *                   type: string
 *                 owner:
 *                   type: string
 *                 address:
 *                   type: string
 *       400:
 *         description: Store not found or retrieval fails
 */
router.get("/:id", getAStore);
/**
 * @swagger
 * /:
 *   get:
 *     summary: Search for products and stores
 *     description: Search for products and stores
 *     tags:
 *       - Stores
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search keyword
 *     responses:
 *       200:
 *         description: Search results containing products and stores
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products:
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
 *                 stores:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       _id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       image:
 *                         type: string
 *                       email:
 *                         type: string
 *                       mobile:
 *                         type: string
 *                       address:
 *                         type: string
 *       400:
 *         description: Search fails
 */
router.get("/", search);

module.exports = router;
