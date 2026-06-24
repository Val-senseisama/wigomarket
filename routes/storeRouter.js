const express = require("express");
const {
  getAStore,
  getAllStores,
  createStore,
  getMyStore,
  updateBankDetails,
  getPopularSellers,
  getNearbySellers,
  getStoreOrders,
  getStoreOrderDetail,
  updateOrderStatus,
  contactCustomer,
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
 * /api/store/orders:
 *   get:
 *     summary: List the logged-in seller's store orders (paginated, filterable)
 *     description: |
 *       Returns orders containing at least one product from the seller's store,
 *       shaped for the order-management dashboard table. Supports category tabs
 *       (recent / ongoing / history), status & order-type filters, date range,
 *       search by order number or customer name, sorting, and pagination.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [recent, ongoing, history], default: recent }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: "Display status: Pending, Confirmed, Preparing, Pick up Ready, In Transit, Delivered, Cancelled"
 *       - in: query
 *         name: orderType
 *         schema: { type: string, enum: ["Pick up", "Delivery"] }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches order number or customer name
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [date, amount], default: date }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Paginated list of order rows with category counts
 *       404:
 *         description: No store found for this account
 */
router.get("/orders", authMiddleware, isSeller, getStoreOrders);

/**
 * @swagger
 * /api/store/orders/{id}:
 *   get:
 *     summary: Get full order detail (seller's order)
 *     description: |
 *       Returns everything the order-details screen needs: header (order number,
 *       date, status), buyer & delivery info, line items with per-unit price and
 *       subtotals, order summary totals, payment info (incl. derived payout
 *       status), the lifecycle timeline (with timestamps from status history),
 *       and the buyer note. Scoped to the logged-in seller's store.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Order detail
 *       404:
 *         description: Order not found or not in this seller's store
 */
router.get("/orders/:id", authMiddleware, isSeller, getStoreOrderDetail);

/**
 * @swagger
 * /api/store/orders/{id}/status:
 *   put:
 *     summary: Update an order's status (seller-controlled transitions)
 *     description: |
 *       Advances one of the seller's own orders through the order state machine.
 *       Transitions are validated and role-enforced — a seller may only move an
 *       order along the allowed flow; non-sequential or out-of-role updates are
 *       rejected (HTTP 422) and the attempt is recorded in the audit log.
 *
 *       **Seller-controlled transitions**
 *       - `pending` → `confirmed`
 *       - `confirmed` → `preparing`
 *       - `preparing` → `pickUpReady`
 *       - `pickUpReady` → `delivered` *(self_delivery / pickup orders only)*
 *       - any pre-shipment state → `cancelled`
 *
 *       Rider-stage transitions (`pickUpReady` → `inTransit` → `delivered`) are
 *       handled by the delivery-agent endpoints, and `delivered` for
 *       delivery_agent orders is gated by the agent+customer dual-confirm flow.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [confirmed, preparing, pickUpReady, delivered, cancelled]
 *               reason:
 *                 type: string
 *                 description: Optional reason, recorded in the audit log
 *     responses:
 *       200:
 *         description: Updated order
 *       400:
 *         description: Missing/invalid status value
 *       403:
 *         description: Order does not belong to this seller's store
 *       422:
 *         description: Illegal or role-forbidden transition
 */
router.put("/orders/:id/status", authMiddleware, isSeller, updateOrderStatus);

/**
 * @swagger
 * /api/store/orders/{id}/contact:
 *   post:
 *     summary: Send a direct message to the buyer of one of the seller's orders
 *     description: |
 *       Sends a free-text message to the customer who placed the order. Scoped to
 *       orders containing a product from the seller's store. The message is
 *       stored as an in-app notification and delivered over the buyer's enabled
 *       channels (push + email).
 *     tags: [Store]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 maxLength: 2000
 *                 example: "Hi, just confirming your delivery address before we ship."
 *     responses:
 *       200:
 *         description: Message sent
 *       400:
 *         description: Missing or invalid message
 *       404:
 *         description: Order not found or does not belong to this seller's store
 */
router.post("/orders/:id/contact", authMiddleware, isSeller, contactCustomer);

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

module.exports = router;
