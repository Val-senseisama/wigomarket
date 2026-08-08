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
  getBusinessAnalytics,
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
 * /api/store/analytics:
 *   get:
 *     summary: Business Analytics figures for the logged-in seller's store
 *     description: |
 *       Backs the "Business Analytics" card on the seller dashboard: pending
 *       orders, total sales, completed orders and active products, each with the
 *       percentage change against the equivalent earlier window.
 *
 *       **Period toggle.** `period` drives the Today / Weekly / Monthly buttons.
 *       Pass one key, several comma-separated keys, or `all` — so the client can
 *       either fetch one tile row or pre-load every toggle state in a single
 *       round trip. `day`, `week` and `month` are accepted aliases.
 *
 *       | period | Window | Compared against |
 *       |--------|--------|------------------|
 *       | `today` | Midnight (Africa/Lagos) → now | The same span yesterday |
 *       | `weekly` | Start of week (Mon) → now | The same span last week |
 *       | `monthly` | 1st of month → now | The same span last month |
 *
 *       Comparison windows are the *same elapsed span* one period earlier, not
 *       the whole previous period — "today so far" is compared with "yesterday
 *       up to this time", otherwise every morning reads as a collapse in sales.
 *
 *       **Metric shape.** Every metric is
 *       `{ value, previous, changePercent }`. `changePercent` is the `+0%` /
 *       `+54%` badge on each tile; growth from zero is reported as `100`
 *       (a percentage change from zero is undefined — check `previous: 0` if
 *       you would rather render "new").
 *
 *       | Metric | Meaning |
 *       |--------|---------|
 *       | `pendingOrders` | Count of orders **placed** in the window still awaiting confirmation |
 *       | `pendingOrdersValue` | Naira value of those pending orders |
 *       | `totalSales` | Store's share of orders **delivered** in the window, at vendor price (what the store is paid) |
 *       | `grossSales` | The same orders at listed price (what customers paid); the difference is the platform margin |
 *       | `completedOrders` | Count of orders delivered in the window |
 *       | `activeProducts` | In-stock products (`quantity > 0`) as of the end of the window |
 *
 *       Multi-store orders are split: sales count only the line items belonging
 *       to this store. Delivery fees are excluded — those go to the rider.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, default: today }
 *         description: "today | weekly | monthly | all | comma-separated combination (e.g. today,weekly)"
 *         examples:
 *           single:
 *             value: today
 *             summary: One toggle state
 *           combined:
 *             value: today,weekly,monthly
 *             summary: All three toggle states in one call
 *           all:
 *             value: all
 *             summary: Shorthand for every period
 *     responses:
 *       200:
 *         description: Analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     period:
 *                       type: string
 *                       description: The first period requested; `metrics` mirrors it
 *                       example: today
 *                     currency: { type: string, example: NGN }
 *                     timezone: { type: string, example: Africa/Lagos }
 *                     generatedAt: { type: string, format: date-time }
 *                     metrics:
 *                       $ref: '#/components/schemas/StoreAnalyticsPeriod'
 *                       description: Alias for `periods[period]`, for single-period requests
 *                     periods:
 *                       type: object
 *                       description: One entry per requested period, keyed by period name
 *                       additionalProperties:
 *                         $ref: '#/components/schemas/StoreAnalyticsPeriod'
 *             examples:
 *               today:
 *                 value:
 *                   success: true
 *                   data:
 *                     period: today
 *                     currency: NGN
 *                     timezone: Africa/Lagos
 *                     generatedAt: "2026-08-05T14:32:10.000+01:00"
 *                     periods:
 *                       today:
 *                         range:
 *                           from: "2026-08-04T23:00:00.000Z"
 *                           to: "2026-08-05T13:32:10.000Z"
 *                           previousFrom: "2026-08-03T23:00:00.000Z"
 *                           previousTo: "2026-08-04T13:32:10.000Z"
 *                         pendingOrders: { value: 3, previous: 2, changePercent: 50 }
 *                         pendingOrdersValue: { value: 24500, previous: 18000, changePercent: 36.1 }
 *                         totalSales: { value: 128000, previous: 96000, changePercent: 33.3 }
 *                         grossSales: { value: 140800, previous: 105600, changePercent: 33.3 }
 *                         completedOrders: { value: 8, previous: 6, changePercent: 33.3 }
 *                         activeProducts: { value: 42, previous: 40, changePercent: 5 }
 *       400:
 *         description: Invalid period value
 *       403:
 *         description: Not a seller
 *       404:
 *         description: No store found for this account
 *
 * components:
 *   schemas:
 *     StoreAnalyticsMetric:
 *       type: object
 *       properties:
 *         value:
 *           type: number
 *           description: The figure for the current window
 *         previous:
 *           type: number
 *           description: The same figure for the comparison window
 *         changePercent:
 *           type: number
 *           description: Percentage change vs `previous`, to 1dp. 100 when growing from zero.
 *     StoreAnalyticsPeriod:
 *       type: object
 *       properties:
 *         range:
 *           type: object
 *           properties:
 *             from: { type: string, format: date-time }
 *             to: { type: string, format: date-time }
 *             previousFrom: { type: string, format: date-time }
 *             previousTo: { type: string, format: date-time }
 *         pendingOrders:
 *           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *         pendingOrdersValue:
 *           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *         totalSales:
 *           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *         grossSales:
 *           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *         completedOrders:
 *           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *         activeProducts:
 *           $ref: '#/components/schemas/StoreAnalyticsMetric'
 */
router.get("/analytics", authMiddleware, isSeller, getBusinessAnalytics);

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
 *
 *       Also includes `allowedActions`: an array of `{ status, label }` the seller
 *       may transition this order to right now (given its state and delivery
 *       method), so the UI renders exactly the valid status buttons. Feed the
 *       chosen `status` to `PUT /api/store/orders/{id}/status`. Empty once the
 *       order is delivered/cancelled or handed to the rider.
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   $ref: '#/components/schemas/StoreOrderDetail'
 *             examples:
 *               deliveryOrder:
 *                 summary: A confirmed delivery order
 *                 value:
 *                   success: true
 *                   data:
 *                     id: "665f1a2b3c4d5e6f70819200"
 *                     orderNumber: "#WM1201"
 *                     orderDate: "2026-08-05T09:14:22.000Z"
 *                     status: confirmed
 *                     statusLabel: Confirmed
 *                     allowedActions:
 *                       - { status: preparing, label: Preparing }
 *                       - { status: pickUpReady, label: "Pick up Ready" }
 *                       - { status: cancelled, label: Cancelled }
 *                     buyer:
 *                       id: "665f1a2b3c4d5e6f70819111"
 *                       name: "Chukwunyere Emma"
 *                       mobile: "09087654323"
 *                       email: "emma@example.com"
 *                     delivery:
 *                       type: Delivery
 *                       method: delivery_agent
 *                       address: "14 Admiralty Way, Lekki Phase 1, Lagos"
 *                       preferredTime: null
 *                       estimatedDeliveryTime: "2026-08-05T11:30:00.000Z"
 *                       deliveryStatus: pending_assignment
 *                       rider: null
 *                     items:
 *                       - productId: "665f1a2b3c4d5e6f70819300"
 *                         title: "Nike Air Force 1"
 *                         image: "https://res.cloudinary.com/demo/image/upload/af1.jpg"
 *                         quantity: 2
 *                         unitPrice: 45000
 *                         subtotal: 90000
 *                     summary:
 *                       itemsTotal: 90000
 *                       deliveryFee: 1500
 *                       total: 91500
 *                       currency: NGN
 *                     payment:
 *                       method: card
 *                       status: Paid
 *                       transactionId: "FLW-REF-8891233"
 *                       payoutStatus: Awaiting
 *                     timeline:
 *                       - { status: pending, label: "Order received", completed: true, at: "2026-08-05T09:14:22.000Z" }
 *                       - { status: confirmed, label: "Order confirmed", completed: true, at: "2026-08-05T09:20:05.000Z" }
 *                       - { status: preparing, label: "Preparing for Delivery", completed: false, at: null }
 *                       - { status: pickUpReady, label: "Ready for Pickup", completed: false, at: null }
 *                       - { status: inTransit, label: "Out for Delivery", completed: false, at: null }
 *                       - { status: delivered, label: "Delivered", completed: false, at: null }
 *                     buyerNote: "Please call when you arrive at the gate."
 *       404:
 *         description: Order not found or not in this seller's store
 *
 * components:
 *   schemas:
 *     StoreOrderDetail:
 *       type: object
 *       description: |
 *         Everything the order-details screen renders. The `buyer` block is also
 *         what fills the "Contact Customer" modal header (name, phone, and
 *         `orderNumber` as the Order ID).
 *       properties:
 *         id:
 *           type: string
 *           description: Mongo order id — the `{id}` for every other order endpoint
 *         orderNumber:
 *           type: string
 *           description: Human-facing order id, already prefixed with "#"
 *           example: "#WM1201"
 *         orderDate: { type: string, format: date-time }
 *         status:
 *           type: string
 *           description: Canonical lifecycle token
 *           enum: [pending, confirmed, preparing, pickUpReady, inTransit, delivered, cancelled]
 *         statusLabel:
 *           type: string
 *           description: Display form of `status`, e.g. "Pick up Ready"
 *         allowedActions:
 *           type: array
 *           description: >
 *             Exactly the transitions this seller may perform on this order right
 *             now. Render one button per entry and send its `status` to
 *             PUT /api/store/orders/{id}/status. Empty once the order is
 *             delivered/cancelled or has been handed to a rider.
 *           items:
 *             type: object
 *             properties:
 *               status: { type: string, example: pickUpReady }
 *               label: { type: string, example: "Pick up Ready" }
 *         buyer:
 *           type: object
 *           properties:
 *             id: { type: string }
 *             name: { type: string, nullable: true }
 *             mobile: { type: string, nullable: true }
 *             email: { type: string, nullable: true }
 *         delivery:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               description: Display label for the delivery method
 *               enum: ["Pick up", "Delivery"]
 *             method:
 *               type: string
 *               enum: [self_delivery, delivery_agent]
 *             address: { type: string, nullable: true }
 *             preferredTime:
 *               type: string
 *               nullable: true
 *               description: Always null — not captured at order time yet
 *             estimatedDeliveryTime: { type: string, format: date-time, nullable: true }
 *             deliveryStatus:
 *               type: string
 *               enum: [pending_assignment, assigned, picked_up, in_transit, delivered, failed]
 *             rider:
 *               type: object
 *               nullable: true
 *               description: Null until a delivery agent takes the order
 *               properties:
 *                 id: { type: string }
 *                 name: { type: string, nullable: true }
 *                 mobile: { type: string, nullable: true }
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               productId: { type: string, nullable: true }
 *               title:
 *                 type: string
 *                 description: '"Unknown product" if the product has since been deleted'
 *               image: { type: string, nullable: true }
 *               quantity: { type: integer }
 *               unitPrice:
 *                 type: number
 *                 description: >
 *                   The product's current listedPrice (falling back to price).
 *                   Unit price is not snapshotted on the order line, so this
 *                   reflects today's price, not necessarily the price paid.
 *               subtotal: { type: number, description: unitPrice × quantity }
 *         summary:
 *           type: object
 *           properties:
 *             itemsTotal: { type: number, description: Sum of the line subtotals }
 *             deliveryFee: { type: number, description: Goes to the rider, not the store }
 *             total:
 *               type: number
 *               description: What the customer actually paid, falling back to itemsTotal + deliveryFee
 *             currency: { type: string, example: NGN }
 *         payment:
 *           type: object
 *           properties:
 *             method: { type: string, nullable: true, enum: [cash, card, bank] }
 *             status:
 *               type: string
 *               enum: [Unpaid, Pending, Paid, Refunded, Failed, "Not yet paid"]
 *             transactionId: { type: string, nullable: true }
 *             payoutStatus:
 *               type: string
 *               description: >
 *                 Derived, not stored — "Unpaid" until the customer has paid,
 *                 then "Awaiting" until delivery, then "Released".
 *               enum: [Unpaid, Awaiting, Released]
 *         timeline:
 *           type: array
 *           description: >
 *             Ordered lifecycle steps for the progress tracker. The `inTransit`
 *             step is omitted on pickup orders. A cancelled order keeps its
 *             completed steps and gains a trailing "Cancelled" step.
 *           items:
 *             type: object
 *             properties:
 *               status: { type: string }
 *               label: { type: string, example: "Preparing for Delivery" }
 *               completed: { type: boolean }
 *               at: { type: string, format: date-time, nullable: true }
 *         buyerNote:
 *           type: string
 *           nullable: true
 *           description: Delivery notes left by the customer
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
 *       - `confirmed` → `pickUpReady` *(or via the optional `preparing` step)*
 *       - `confirmed` → `preparing` → `pickUpReady`
 *       - `pickUpReady` → `delivered` *(self_delivery / pickup orders only)*
 *       - any pre-shipment state → `cancelled`
 *
 *       `preparing` is optional — the seller can skip straight from `confirmed`
 *       to `pickUpReady`. The order detail response (`GET /api/store/orders/{id}`)
 *       returns an `allowedActions` array listing exactly which statuses are valid
 *       from the current state, so the UI can render the right buttons.
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
 *                 description: >
 *                   Optional. Recorded in the audit log and nowhere else — it does
 *                   not affect the transition, the order document, or the response.
 *                   The dashboard's status buttons capture no reason, so simply
 *                   omit the key. Do not send `""`: blank values are discarded
 *                   server-side rather than written, so sending one is only noise.
 *           examples:
 *             advance:
 *               summary: What the dashboard buttons send
 *               value: { status: "confirmed" }
 *             cancelWithReason:
 *               summary: A flow that does capture a reason
 *               value: { status: "cancelled", reason: "Item out of stock" }
 *     responses:
 *       200:
 *         description: |
 *           The updated raw order document (`data`), not the serialized detail
 *           shape. Re-fetch `GET /api/store/orders/{id}` to refresh the screen —
 *           in particular to get the new `allowedActions` for the next button.
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
 *       Backs the "Contact Customer" modal on the order-details screen. Sends a
 *       free-text message to the customer who placed the order. Scoped to orders
 *       containing a product from the seller's store, so a seller can only
 *       message their own customers. The message is stored as an in-app
 *       notification and delivered over the buyer's enabled channels
 *       (push + email); a push/email delivery failure does not fail the request.
 *
 *       The modal header (customer name, phone, Order ID) comes from the
 *       `buyer` and `orderNumber` fields of `GET /api/store/orders/{id}` — this
 *       endpoint only needs the message body.
 *
 *       Sender identity shown to the buyer is the store's name, so the buyer
 *       sees "Message from {store} about #WM1201".
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
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 maxLength: 2000
 *                 example: "Hi, just confirming your delivery address before we ship."
 *     responses:
 *       200:
 *         description: Message sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     notificationId:
 *                       type: string
 *                       description: The in-app notification created for the buyer
 *                     orderId: { type: string }
 *                     orderNumber:
 *                       type: string
 *                       nullable: true
 *                       description: Without the "#" prefix, unlike the order detail response
 *                       example: WM1201
 *                     recipient:
 *                       type: object
 *                       properties:
 *                         id: { type: string }
 *                         name: { type: string, example: "Chukwunyere Emma" }
 *                         email: { type: string, nullable: true }
 *                         mobile: { type: string, nullable: true }
 *                     message:
 *                       type: string
 *                       description: The message as stored (trimmed)
 *                     sentAt: { type: string, format: date-time }
 *             examples:
 *               sent:
 *                 value:
 *                   success: true
 *                   data:
 *                     notificationId: "665f1a2b3c4d5e6f70819400"
 *                     orderId: "665f1a2b3c4d5e6f70819200"
 *                     orderNumber: WM1201
 *                     recipient:
 *                       id: "665f1a2b3c4d5e6f70819111"
 *                       name: "Chukwunyere Emma"
 *                       email: "emma@example.com"
 *                       mobile: "09087654323"
 *                     message: "Your order is being packed and will ship today."
 *                     sentAt: "2026-08-05T10:02:41.000Z"
 *       400:
 *         description: Missing, blank, or over-long (>2000 chars) message
 *       404:
 *         description: Order not found or does not belong to this seller's store
 *       422:
 *         description: This order has no associated customer
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
