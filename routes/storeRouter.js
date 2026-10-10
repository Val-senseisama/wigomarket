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
  getStoreEarnings,
  getRecentEarnings,
  getRecentOrders,
  updateMyStore,
  getStoreSettings,
  updateStoreSettings,
} = require("../controllers/store");
const { updateStoreLocation } = require("../controllers/storeController");
const {
  listStoreRefundRequests,
  getStoreRefundRequest,
  approveRefundRequest,
  rejectRefundRequest,
} = require("../controllers/refund/seller");
const { authMiddleware, isSeller } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     StoreOrderRow:
 *       type: object
 *       description: One row of the seller's order-management table.
 *       properties:
 *         id: { type: string, description: 'Mongo id — use it for GET /api/store/orders/{id}' }
 *         orderNumber:
 *           type: string
 *           description: Human-facing order id, already prefixed with "#".
 *           example: "#WM1201"
 *         orderDate: { type: string, format: date-time }
 *         customer:
 *           type: object
 *           properties:
 *             id: { type: string, nullable: true }
 *             name: { type: string, nullable: true, example: "Chidi Okafor" }
 *             email: { type: string, nullable: true }
 *             mobile: { type: string, nullable: true }
 *         itemsCount:
 *           type: integer
 *           description: |
 *             Total units, not the number of lines. In the seller list
 *             (`/api/store/orders`) only this store's units; in the admin list
 *             the whole order's.
 *           example: 3
 *         amount:
 *           type: number
 *           description: |
 *             In the seller list (`/api/store/orders`): what the customer paid
 *             for this store's items only — no delivery fee, no other sellers'
 *             items — the same figure as the Recent Orders widget. In the admin
 *             list: the whole order total the customer paid, delivery included.
 *           example: 17400
 *         currency: { type: string, example: "NGN" }
 *         deliveryType: { type: string, enum: ["Pick up", "Delivery"] }
 *         status:
 *           type: string
 *           enum: [pending, confirmed, preparing, pickUpReady, inTransit, delivered, cancelled]
 *           description: Canonical lifecycle token — filter and compare on this.
 *         statusLabel:
 *           type: string
 *           description: Display text for the status pill.
 *           example: "Pick up Ready"
 *         allowedActions:
 *           type: array
 *           description: |
 *             Statuses the viewer may move this order to right now — render
 *             exactly these in the row's "Update Status" menu, then call
 *             `PUT /api/store/orders/{id}/status` with the chosen `status`.
 *             Identical to `allowedActions` on the order detail; empty when no
 *             transition is available (e.g. delivered or cancelled).
 *           items:
 *             type: object
 *             properties:
 *               status: { type: string, example: "pickUpReady" }
 *               label: { type: string, example: "Pick up Ready" }
 *         raw:
 *           type: object
 *           description: Underlying document fields, for detail views and overrides.
 *           properties:
 *             orderStatus: { type: string }
 *             deliveryStatus: { type: string }
 *             paymentStatus: { type: string }
 *             deliveryMethod: { type: string, enum: [self_delivery, delivery_agent] }
 */
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
 *                 isVisible:
 *                   type: boolean
 *                   description: false = hidden from buyers (see PUT /api/store/settings)
 *                 openingHours:
 *                   $ref: '#/components/schemas/StoreOpeningHours'
 *                 isOpenNow:
 *                   type: boolean
 *                   nullable: true
 *                 fulfilmentOptions:
 *                   type: array
 *                   items:
 *                     type: string
 *                     enum: [delivery, pickup]
 *       400:
 *         description: Store not found or retrieval fails
 */
router.get("/my-store", authMiddleware, isSeller, getMyStore);
/**
 * @swagger
 * /api/store/my-store:
 *   put:
 *     summary: Edit my shop's details (partial)
 *     description: |
 *       Send only the fields to change; at least one is required. The address
 *       is edited through `PUT /api/store/update-location` (it geocodes it);
 *       NIN and bank details have their own endpoints. Other fields are ignored.
 *       Visibility, opening hours and fulfilment options are in `PUT /api/store/settings`.
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
 *             minProperties: 1
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 80
 *                 description: Unique across shops (case-insensitive)
 *               description:
 *                 type: string
 *                 maxLength: 1000
 *                 description: Send "" to clear
 *               image:
 *                 type: string
 *                 description: Cloudinary URL from POST /api/upload/signature
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Shop contact email, unique
 *               mobile:
 *                 type: string
 *                 description: Shop contact number, unique; stored as 234XXXXXXXXXX
 *               businessType:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *           example:
 *             description: "Fresh groceries delivered daily"
 *             city: "Ikeja"
 *     responses:
 *       200:
 *         description: Updated store (owner view)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   description: The full store document
 *       400:
 *         description: No fields sent, a field is invalid, or name/email/mobile already in use
 *       403:
 *         description: Not a seller
 *       404:
 *         description: The seller has no store
 */
router.put("/my-store", authMiddleware, isSeller, updateMyStore);
/**
 * @swagger
 * /api/store/settings:
 *   get:
 *     summary: Get my shop's preferences
 *     description: Visibility, opening hours (with whether the shop is open now) and fulfilment options.
 *     tags:
 *       - Stores
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Shop preferences
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoreSettingsResponse'
 *       403:
 *         description: Not a seller
 *       404:
 *         description: The seller has no store
 *   put:
 *     summary: Update my shop's preferences (partial)
 *     description: |
 *       Send any of the three; omitted ones are unchanged.
 *
 *       - **isVisible** — `false` hides the shop: it and all its products drop
 *         out of every listing, search, home feed and suggestion, its page
 *         (`GET /api/store/{id}`) and its products' pages return 404, and
 *         checkout is refused for its items. Your own views (my-store, your
 *         product list) are unaffected and products keep their own status, so
 *         `true` restores everything as it was.
 *       - **openingHours** — weekly hours, **display only**: buyers see them and
 *         `isOpenNow`, but orders are accepted at any time. Days not listed are
 *         closed; `isOpen: false` marks a closed day explicitly. A `close`
 *         earlier than `open` (e.g. 18:00–02:00) runs past midnight. `null` clears.
 *       - **fulfilmentOptions** — how buyers can receive orders: `delivery`
 *         (rider, order deliveryMethod `delivery_agent`) and/or `pickup`
 *         (buyer collects, deliveryMethod `self_delivery`). Enforced at checkout.
 *         Default both.
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
 *             minProperties: 1
 *             properties:
 *               isVisible:
 *                 type: boolean
 *               openingHours:
 *                 type: object
 *                 nullable: true
 *                 required: [days]
 *                 properties:
 *                   timezone:
 *                     type: string
 *                     description: IANA timezone, default Africa/Lagos
 *                   days:
 *                     type: array
 *                     items:
 *                       type: object
 *                       required: [day]
 *                       properties:
 *                         day:
 *                           type: string
 *                           enum: [monday, tuesday, wednesday, thursday, friday, saturday, sunday]
 *                         isOpen:
 *                           type: boolean
 *                           default: true
 *                         open:
 *                           type: string
 *                           description: 24-hour HH:mm; required when isOpen
 *                         close:
 *                           type: string
 *                           description: 24-hour HH:mm; required when isOpen
 *               fulfilmentOptions:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: string
 *                   enum: [delivery, pickup]
 *           example:
 *             isVisible: true
 *             openingHours:
 *               timezone: Africa/Lagos
 *               days:
 *                 - { day: monday, open: "09:00", close: "18:00" }
 *                 - { day: tuesday, open: "09:00", close: "18:00" }
 *                 - { day: saturday, open: "10:00", close: "16:00" }
 *                 - { day: sunday, isOpen: false }
 *             fulfilmentOptions: [delivery, pickup]
 *     responses:
 *       200:
 *         description: Updated preferences
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoreSettingsResponse'
 *       400:
 *         description: Nothing to update, or an invalid value (bad day/time/timezone, empty or unknown fulfilment option)
 *       403:
 *         description: Not a seller
 *       404:
 *         description: The seller has no store
 */
router.get("/settings", authMiddleware, isSeller, getStoreSettings);
router.put("/settings", authMiddleware, isSeller, updateStoreSettings);

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
 * /api/store/earnings:
 *   get:
 *     summary: Earnings & Transactions for the logged-in seller's store
 *     description: |
 *       Backs the seller's "Earnings & Transactions" screen in one call: the
 *       **Earnings Summary** cards and the paginated **Recent Earning** table.
 *
 *       **What counts as an earning.** An order containing this store's
 *       products whose payment has gone through. The vendor share is credited
 *       at payment time, so a paid order is an earned order — delivery is not a
 *       precondition.
 *
 *       **Refunds.** Once a refund the seller (or an admin) approved has gone
 *       through, the seller's share of it is subtracted from that order:
 *       `amountEarned` is what the store keeps, with `grossAmount` and
 *       `refundedAmount` alongside, and every card total uses the net figure.
 *       `status` is this store's own position — `paid`, `partially_refunded`
 *       or `refunded` (₦0 kept, still listed). A refund still in progress does
 *       not change the row: the money stays in the seller's wallet until then.
 *
 *       **Amount earned** is this store's line items only, at vendor price
 *       (what the store is paid, excluding the platform margin). Multi-store
 *       orders are split; delivery fees go to the rider and are excluded.
 *
 *       **Summary cards** always cover the whole store — search, date and
 *       status filters only affect the table. Each card is
 *       `{ value, previous, changePercent }` (`changePercent` is the `+54%`
 *       badge; growth from zero reports `100`).
 *
 *       | Card | `value` | Compared against (`previous`) |
 *       |------|---------|-------------------------------|
 *       | `totalEarnings` | Lifetime earnings | Lifetime earnings at the start of this month |
 *       | `weeklyEarnings` | Monday 00:00 (Africa/Lagos) → now | The same span last week |
 *       | `todayEarnings` | Midnight (Africa/Lagos) → now | The same span yesterday |
 *
 *       Card windows use the time the payment was received; the table's date
 *       filter uses the order date shown in the Order Date column.
 *
 *       When only paging or filtering the table, pass `summary=false` to skip
 *       the card aggregation.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: |
 *           Order number, product name, customer name, or amount earned.
 *           Amounts match exactly and accept `5000`, `₦5,000` or `5,000.50`.
 *         example: Indomie
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *         description: Inclusive start on order date. A bare date is the start of that day (Africa/Lagos).
 *         example: "2026-10-01"
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *         description: |
 *           Inclusive end on order date. A bare date is the **end** of that day
 *           (Africa/Lagos), so `dateFrom=dateTo=2026-10-01` returns that whole day.
 *         example: "2026-10-31"
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [paid, partially_refunded, refunded] }
 *         description: Filter rows by this store's refund position. Comma-separate or repeat for several. Default all.
 *       - in: query
 *         name: sortBy
 *         schema: { type: string, enum: [date, amount], default: date }
 *       - in: query
 *         name: sortOrder
 *         schema: { type: string, enum: [asc, desc], default: desc }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, minimum: 1, maximum: 100 }
 *         description: The "Rows per page" selector
 *       - in: query
 *         name: summary
 *         schema: { type: boolean, default: true }
 *         description: Set `false` to omit `summary` (e.g. when only changing page)
 *     responses:
 *       200:
 *         description: Earnings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     currency: { type: string, example: NGN }
 *                     timezone: { type: string, example: Africa/Lagos }
 *                     generatedAt: { type: string, format: date-time }
 *                     summary:
 *                       type: object
 *                       description: Omitted when `summary=false`
 *                       properties:
 *                         totalEarnings:
 *                           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *                         weeklyEarnings:
 *                           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *                         todayEarnings:
 *                           $ref: '#/components/schemas/StoreAnalyticsMetric'
 *                         paidOrders:
 *                           type: integer
 *                           description: Lifetime count of paid orders, excluding ones fully refunded
 *                         ranges:
 *                           type: object
 *                           description: The windows behind each card, for tooltips
 *                           properties:
 *                             total:
 *                               type: object
 *                               properties:
 *                                 previousTo: { type: string, format: date-time }
 *                             weekly:
 *                               type: object
 *                               properties:
 *                                 from: { type: string, format: date-time }
 *                                 to: { type: string, format: date-time }
 *                                 previousFrom: { type: string, format: date-time }
 *                                 previousTo: { type: string, format: date-time }
 *                             today:
 *                               type: object
 *                               properties:
 *                                 from: { type: string, format: date-time }
 *                                 to: { type: string, format: date-time }
 *                                 previousFrom: { type: string, format: date-time }
 *                                 previousTo: { type: string, format: date-time }
 *                     earnings:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/StoreEarning'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         total: { type: integer }
 *                         page: { type: integer }
 *                         limit: { type: integer }
 *                         pages: { type: integer }
 *                         hasMore: { type: boolean }
 *             example:
 *               success: true
 *               data:
 *                 currency: NGN
 *                 timezone: Africa/Lagos
 *                 generatedAt: "2026-10-02T14:32:10.000+01:00"
 *                 summary:
 *                   totalEarnings: { value: 100000, previous: 100000, changePercent: 0 }
 *                   weeklyEarnings: { value: 5000, previous: 3246.75, changePercent: 54 }
 *                   todayEarnings: { value: 10000, previous: 10000, changePercent: 0 }
 *                   paidOrders: 20
 *                   ranges:
 *                     total: { previousTo: "2026-09-30T23:00:00.000Z" }
 *                     weekly:
 *                       from: "2026-09-27T23:00:00.000Z"
 *                       to: "2026-10-02T13:32:10.000Z"
 *                       previousFrom: "2026-09-20T23:00:00.000Z"
 *                       previousTo: "2026-09-25T13:32:10.000Z"
 *                     today:
 *                       from: "2026-10-01T23:00:00.000Z"
 *                       to: "2026-10-02T13:32:10.000Z"
 *                       previousFrom: "2026-09-30T23:00:00.000Z"
 *                       previousTo: "2026-10-01T13:32:10.000Z"
 *                 earnings:
 *                   - id: "66fd1c2e9b1e8a0012ab34cd"
 *                     orderNumber: "#WM1201"
 *                     productSold: "Indomie Noodles (40 Pack)"
 *                     products:
 *                       - productId: "66fa0b1e9b1e8a0012ab1111"
 *                         title: "Indomie Noodles (40 Pack)"
 *                         image: "https://res.cloudinary.com/demo/image/upload/indomie.jpg"
 *                         quantity: 1
 *                         unitPrice: 5000
 *                         amount: 5000
 *                     customer: { id: "66f0aa119b1e8a0012ab9999", name: "Gilbert Johnston" }
 *                     orderDate: "2023-11-08T10:15:00.000Z"
 *                     earnedAt: "2023-11-08T10:16:02.000Z"
 *                     amountEarned: 5000
 *                     grossAmount: 5000
 *                     refundedAmount: 0
 *                     currency: NGN
 *                     status: paid
 *                     statusLabel: Paid
 *                 pagination: { total: 100, page: 1, limit: 10, pages: 10, hasMore: true }
 *       400:
 *         description: Invalid `dateFrom`/`dateTo`/`status`, or `dateFrom` after `dateTo`
 *         content:
 *           application/json:
 *             example: { success: false, message: "dateFrom must be on or before dateTo" }
 *       403:
 *         description: Not a seller
 *       404:
 *         description: No store found for this account
 *
 * components:
 *   schemas:
 *     StoreEarning:
 *       type: object
 *       description: One row of the Recent Earning table
 *       properties:
 *         id: { type: string, description: Order id }
 *         orderNumber: { type: string, example: "#WM1201", description: The Order ID column }
 *         productSold:
 *           type: string
 *           description: The Product Sold cell — first product title, plus "+N more" when the order has several of this store's products
 *           example: "Indomie Noodles (40 Pack) +1 more"
 *         products:
 *           type: array
 *           description: Every line item from this store in the order
 *           items:
 *             type: object
 *             properties:
 *               productId: { type: string }
 *               title: { type: string, description: '"Deleted product" if the product no longer exists' }
 *               image: { type: string, nullable: true }
 *               quantity: { type: integer }
 *               unitPrice: { type: number, description: "Vendor price per unit (naira), as captured when the order was placed" }
 *               amount: { type: number, description: unitPrice × quantity (naira) }
 *         customer:
 *           type: object
 *           properties:
 *             id: { type: string, nullable: true }
 *             name: { type: string, nullable: true }
 *         orderDate: { type: string, format: date-time, description: When the order was placed }
 *         earnedAt: { type: string, format: date-time, description: When payment was received (falls back to orderDate) }
 *         amountEarned: { type: number, description: "What the store keeps from this order (naira): its share at vendor price, less settled refunds" }
 *         grossAmount: { type: number, description: This store's share before refunds }
 *         refundedAmount: { type: number, description: This store's share given back through settled refunds }
 *         currency: { type: string, example: NGN }
 *         status: { type: string, enum: [paid, partially_refunded, refunded] }
 *         statusLabel: { type: string, enum: [Paid, Partially refunded, Refunded] }
 */
router.get("/earnings", authMiddleware, isSeller, getStoreEarnings);

/**
 * @swagger
 * /api/store/earnings/recent:
 *   get:
 *     summary: Latest few earnings, for the dashboard's Recent Earnings widget
 *     description: |
 *       A lightweight sibling of `GET /api/store/earnings` for the dashboard
 *       card: the store's most recent sales, newest first by when the payment
 *       was received. No summary cards, search, filters or total count.
 *
 *       Amounts come from the same calculation as the Earnings & Transactions
 *       table, so an order shows the same figure in both: `amount` is what the
 *       store keeps (its share at vendor price, less settled refunds), with
 *       `grossAmount` and `refundedAmount` alongside.
 *
 *       `statusLabel` uses the widget's wording — `paid` reads "Successful"
 *       here, "Paid" in the full table; `status` is the same token in both.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5, minimum: 1, maximum: 20 }
 *     responses:
 *       200:
 *         description: Recent earnings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     currency: { type: string, example: NGN }
 *                     earnings:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, description: Order id }
 *                           orderNumber: { type: string, example: "#WM1201" }
 *                           type: { type: string, enum: [sale] }
 *                           title: { type: string, example: Sales, description: The row heading }
 *                           amount: { type: number, description: What the store keeps from this order (naira) }
 *                           grossAmount: { type: number, description: The store's share before refunds }
 *                           refundedAmount: { type: number, description: Given back through settled refunds }
 *                           currency: { type: string, example: NGN }
 *                           earnedAt: { type: string, format: date-time, description: When the payment was received — the row's date and time }
 *                           status: { type: string, enum: [paid, partially_refunded, refunded] }
 *                           statusLabel: { type: string, enum: [Successful, Partially refunded, Refunded] }
 *             example:
 *               success: true
 *               data:
 *                 currency: NGN
 *                 earnings:
 *                   - id: "66fd1c2e9b1e8a0012ab34cd"
 *                     orderNumber: "#WM1201"
 *                     type: sale
 *                     title: Sales
 *                     amount: 10000
 *                     grossAmount: 10000
 *                     refundedAmount: 0
 *                     currency: NGN
 *                     earnedAt: "2025-06-05T09:00:00.000Z"
 *                     status: paid
 *                     statusLabel: Successful
 *       403:
 *         description: Not a seller
 *       404:
 *         description: No store found for this account
 */
router.get("/earnings/recent", authMiddleware, isSeller, getRecentEarnings);

/**
 * @swagger
 * /api/store/refund-requests:
 *   get:
 *     summary: Refund requests buyers have sent this store
 *     description: |
 *       Buyers ask the seller — not the platform — for refunds, because the
 *       seller already holds the money. Each request covers this store's items
 *       in one order. Requests awaiting a response (`status=requested`) carry
 *       `allowedActions: [approve, reject]`; the seller has until `respondBy`
 *       (3 days) before the buyer may escalate to WigoMarket.
 *
 *       `vendorAmount` is what approving will take back out of the seller's
 *       wallet; `amount` is what the buyer receives (the platform returns its
 *       own margin, `platformAmount`).
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: One or more comma-separated raw statuses, e.g. `requested`
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Refund requests
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     refunds:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/RefundRequest'
 *                     pagination:
 *                       $ref: '#/components/schemas/RefundPagination'
 *                     counts:
 *                       type: object
 *                       properties:
 *                         awaitingResponse: { type: integer, description: "Requests waiting on this seller, for a badge" }
 *       400:
 *         description: Invalid status
 *       404:
 *         description: No store found for this account
 */
router.get("/refund-requests", authMiddleware, isSeller, listStoreRefundRequests);

/**
 * @swagger
 * /api/store/refund-requests/{id}:
 *   get:
 *     summary: One refund request for this store
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The refund request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     refund:
 *                       $ref: '#/components/schemas/RefundRequest'
 *       404:
 *         description: Not found, or not this store's
 */
router.get("/refund-requests/:id", authMiddleware, isSeller, getStoreRefundRequest);

/**
 * @swagger
 * /api/store/refund-requests/{id}/approve:
 *   post:
 *     summary: Approve a refund request
 *     description: |
 *       Sends `amount` back to the buyer through the payment provider that
 *       took the charge (Monnify or Flutterwave) and takes
 *       `vendorAmount` out of the seller's wallet. The response's
 *       `statusLabel` is "Refunded" when it completed straight away, or
 *       "Refund in progress" while the payout finishes (it is retried
 *       automatically). If the wallet no longer holds the full share (it was
 *       withdrawn), the buyer is still refunded and the difference is recorded
 *       as owed by the seller.
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Approved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     refund:
 *                       $ref: '#/components/schemas/RefundRequest'
 *       404:
 *         description: Not found, or not this store's
 *       409:
 *         description: Not awaiting a response (already answered, escalated or withdrawn)
 */
router.post("/refund-requests/:id/approve", authMiddleware, isSeller, approveRefundRequest);

/**
 * @swagger
 * /api/store/refund-requests/{id}/reject:
 *   post:
 *     summary: Reject a refund request
 *     description: A reason is required and is shown to the buyer, who may then escalate to WigoMarket.
 *     tags: [Refunds]
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, example: "The item was delivered sealed and undamaged." }
 *     responses:
 *       200:
 *         description: Rejected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     refund:
 *                       $ref: '#/components/schemas/RefundRequest'
 *       400:
 *         description: Reason missing
 *       404:
 *         description: Not found, or not this store's
 *       409:
 *         description: Not awaiting a response
 */
router.post("/refund-requests/:id/reject", authMiddleware, isSeller, rejectRefundRequest);

/**
 * @swagger
 * /api/store/orders:
 *   get:
 *     summary: List the logged-in seller's store orders (paginated, filterable)
 *     description: |
 *       Returns orders containing at least one product from the seller's store,
 *       shaped for the order-management dashboard table. Supports category tabs
 *       (all / pending / ongoing / history), a multi-select status filter, an
 *       order-type filter, date range, search by order number or customer name,
 *       sorting, and pagination.
 *
 *       Each row carries `allowedActions`, so the table's "Update Status" menu
 *       needs no extra call to the order detail.
 *
 *       **This store's part only.** `itemsCount` and `amount` cover the seller's
 *       own items in each order (what the customer paid for them) — not other
 *       sellers' items in the same order, and not the delivery fee. These match
 *       the Recent Orders widget. `sortBy=amount` still orders by the whole
 *       order's total, so in multi-seller orders the sort can differ slightly
 *       from the `amount` shown.
 *
 *       **Unpaid card/bank orders are hidden.** A card or bank order appears
 *       only once its payment has gone through, so sellers never prepare an
 *       abandoned checkout. Cash orders (paid on delivery) appear as soon as
 *       they are placed. Tab `counts` use the same rule.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string, enum: [all, pending, ongoing, history], default: all }
 *         description: |
 *           Tab filter. Values match the keys of `counts`:
 *           - `all` — every order
 *           - `pending` — awaiting confirmation (a subset of `ongoing`)
 *           - `ongoing` — every order not yet delivered or cancelled, including pending
 *           - `history` — delivered or cancelled
 *
 *           `recent` is still accepted as a deprecated alias of `all`.
 *           Unknown values return 400.
 *       - in: query
 *         name: status
 *         style: form
 *         explode: true
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [pending, confirmed, preparing, pickUpReady, inTransit, delivered, cancelled]
 *         description: |
 *           One or more statuses; an order matches if it has **any** of them.
 *           Combined with the other filters (including `category`) using AND.
 *
 *           Repeat the key (`?status=pending&status=confirmed`) or
 *           comma-separate (`?status=pending,confirmed`). Send the canonical
 *           tokens above; display labels (`Pick up Ready`) and legacy values
 *           are also accepted. Unknown values return 400 rather than being
 *           silently ignored.
 *       - in: query
 *         name: orderType
 *         schema: { type: string, enum: ["Pick up", "Delivery"] }
 *       - in: query
 *         name: dateFrom
 *         schema: { type: string, format: date }
 *         description: Inclusive start on order date. A bare date is the start of that day (Africa/Lagos).
 *         example: "2026-10-01"
 *       - in: query
 *         name: dateTo
 *         schema: { type: string, format: date }
 *         description: |
 *           Inclusive end on order date. A bare date is the **end** of that day
 *           (Africa/Lagos), so `dateFrom=dateTo=2026-10-01` returns that whole day.
 *           Full ISO timestamps are also accepted and used as-is.
 *         example: "2026-10-31"
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/StoreOrderRow' }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *                     counts:
 *                       type: object
 *                       description: >
 *                         Tab totals, keyed by the `category` values. Scoped to
 *                         the store but ignoring the other filters, so each tab
 *                         shows its true total. `all` = `ongoing` + `history`;
 *                         `pending` is a subset of `ongoing`.
 *                       properties:
 *                         all: { type: integer }
 *                         pending: { type: integer }
 *                         ongoing: { type: integer }
 *                         history: { type: integer }
 *             example:
 *               success: true
 *               data:
 *                 orders:
 *                   - id: "66f1a2b3c4d5e6f708192a3b"
 *                     orderNumber: "#WM1201"
 *                     orderDate: "2026-08-24T15:41:09.117Z"
 *                     customer:
 *                       id: "66a0b1c2d3e4f5a6b7c8d9e0"
 *                       name: "Chidi Okafor"
 *                       email: "chidi@example.com"
 *                       mobile: "2348012345678"
 *                     itemsCount: 3
 *                     amount: 17400
 *                     currency: "NGN"
 *                     deliveryType: "Delivery"
 *                     status: "preparing"
 *                     statusLabel: "Preparing"
 *                     allowedActions:
 *                       - { status: "pickUpReady", label: "Pick up Ready" }
 *                       - { status: "cancelled", label: "Cancelled" }
 *                     raw:
 *                       orderStatus: "preparing"
 *                       deliveryStatus: "pending_assignment"
 *                       paymentStatus: "Paid"
 *                       deliveryMethod: "delivery_agent"
 *                   - id: "66f1a2b3c4d5e6f708192a3c"
 *                     orderNumber: "#WM1200"
 *                     orderDate: "2026-08-23T09:12:44.002Z"
 *                     customer:
 *                       id: "66a0b1c2d3e4f5a6b7c8d9e1"
 *                       name: "Amaka Eze"
 *                       email: "amaka@example.com"
 *                       mobile: "2348098765432"
 *                     itemsCount: 1
 *                     amount: 5000
 *                     currency: "NGN"
 *                     deliveryType: "Pick up"
 *                     status: "delivered"
 *                     statusLabel: "Delivered"
 *                     allowedActions: []
 *                     raw:
 *                       orderStatus: "delivered"
 *                       deliveryStatus: "delivered"
 *                       paymentStatus: "Paid"
 *                       deliveryMethod: "self_delivery"
 *                 pagination:
 *                   total: 42
 *                   page: 1
 *                   limit: 10
 *                   pages: 5
 *                   hasMore: true
 *                 counts: { all: 42, pending: 4, ongoing: 11, history: 31 }
 *       400:
 *         description: Unknown `category` or `status` value, unparseable `dateFrom`/`dateTo`, or `dateFrom` after `dateTo`
 *       404:
 *         description: No store found for this account
 */
router.get("/orders", authMiddleware, isSeller, getStoreOrders);

/**
 * @swagger
 * /api/store/orders/recent:
 *   get:
 *     summary: Newest orders, for the dashboard's Recent Orders widget
 *     description: |
 *       A lightweight sibling of `GET /api/store/orders` for the dashboard card:
 *       the store's newest orders, newest first. No filters, search, tab counts
 *       or `allowedActions` — "View all" goes to the full list for those.
 *
 *       `items` and `amount` cover **this store's items only**: what the
 *       customer paid for them, excluding other sellers' items in the same
 *       order and the delivery fee — the same figures as the full list.
 *
 *       Same visibility as the full list: a card or bank order appears only
 *       once paid; cash orders appear as soon as they are placed.
 *
 *       **Live updates.** Open a WebSocket to `/ws/orders` (same JWT, as
 *       `?token=<jwt>` or an `Authorization: Bearer` header) to keep the widget
 *       current without polling. Each message is:
 *
 *       ```json
 *       { "type": "order.created", "storeId": "…", "order": { …row… }, "at": "2026-10-02T10:15:00.000Z" }
 *       ```
 *
 *       `order` has exactly the shape of a row below. On `order.created` — a
 *       cash order placed, or a card order whose payment just went through —
 *       prepend it (and drop the last row to keep the size); on
 *       `order.updated` (status changed), replace the row with the same `id`
 *       if it is showing. Unpaid card/bank orders produce no events. The first message after
 *       connecting is `{ "type": "connection", "storeId": "…" }`. The socket is
 *       closed with code 1008 if the token is missing/invalid or the user has
 *       no store. Refetch this endpoint after a reconnect to catch anything
 *       missed while disconnected.
 *     tags: [Stores]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5, minimum: 1, maximum: 20 }
 *     responses:
 *       200:
 *         description: Recent orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/StoreRecentOrder'
 *                     live:
 *                       type: object
 *                       description: Where to subscribe for live updates
 *                       properties:
 *                         path: { type: string, example: /ws/orders }
 *                         events:
 *                           type: array
 *                           items: { type: string }
 *                           example: [order.created, order.updated]
 *             example:
 *               success: true
 *               data:
 *                 orders:
 *                   - id: "66fd1c2e9b1e8a0012ab34cd"
 *                     orderNumber: "#WM1201"
 *                     items: 10
 *                     amount: 10000
 *                     currency: NGN
 *                     orderDate: "2023-11-08T10:15:00.000Z"
 *                     customer: { id: "66f0aa119b1e8a0012ab9999", name: "Gilbert Johnston" }
 *                     status: pending
 *                     statusLabel: Pending
 *                     paymentStatus: Paid
 *                 live: { path: /ws/orders, events: [order.created, order.updated] }
 *       403:
 *         description: Not a seller
 *       404:
 *         description: No store found for this account
 *
 * components:
 *   schemas:
 *     StoreRecentOrder:
 *       type: object
 *       description: One Recent Orders row; also the `order` payload of /ws/orders events
 *       properties:
 *         id: { type: string }
 *         orderNumber: { type: string, example: "#WM1201" }
 *         items: { type: integer, description: Units of this store's products in the order }
 *         amount: { type: number, description: What the customer paid for this store's items (naira) }
 *         currency: { type: string, example: NGN }
 *         orderDate: { type: string, format: date-time }
 *         customer:
 *           type: object
 *           properties:
 *             id: { type: string, nullable: true }
 *             name: { type: string, nullable: true }
 *         status:
 *           type: string
 *           enum: [pending, confirmed, preparing, pickUpReady, inTransit, delivered, cancelled]
 *         statusLabel: { type: string, example: Pending }
 *         paymentStatus:
 *           type: string
 *           enum: [Unpaid, Pending, Paid, Partially Refunded, Refunded, Failed, "Not yet paid"]
 */
router.get("/orders/recent", authMiddleware, isSeller, getRecentOrders);

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
 *                       transactionId: "MNFY|20|20260805091422|000123"
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
 *                   What the customer paid per unit, as captured when the
 *                   order was placed. Orders placed before price snapshots
 *                   existed fall back to the product's current listedPrice.
 *               subtotal: { type: number, description: unitPrice × quantity }
 *         summary:
 *           type: object
 *           properties:
 *             itemsTotal: { type: number, description: Sum of the line subtotals }
 *             deliveryFee: { type: number, description: "Goes to the rider, not the store" }
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
 *       **Cancelling a paid order refunds the customer automatically.** Stock is
 *       restored and a refund is queued in the same step, then sent to
 *       the payment provider in the background. The order's `paymentStatus` stays `Paid`
 *       until the refund has gone through, then becomes `Refunded`.
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
 *         description: |
 *           `status` missing, or not one of the canonical status tokens.
 *           Body: `{ success: false, message }`.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             examples:
 *               missing:
 *                 value: { success: false, message: "status is required" }
 *               invalid:
 *                 value: { success: false, message: "Invalid status value: 'shipped'" }
 *       403:
 *         description: |
 *           The order does not contain a product from this seller's store.
 *           Body: `{ success: false, message }`.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             example: { success: false, message: "This order does not belong to your store" }
 *       404:
 *         description: |
 *           The account has no store. Body: `{ success: false, message }`.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             example: { success: false, message: "No store found for this account" }
 *       409:
 *         description: |
 *           The order is already in the requested status (e.g. a double-click).
 *           Safe to treat as success and re-fetch. Body: `{ success: false, message }`.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             example: { success: false, message: "Order is already 'confirmed'" }
 *       422:
 *         description: |
 *           The state machine rejected the transition — it is not allowed from
 *           the order's current status for a seller (e.g. the order moved on
 *           since the menu was rendered). The attempt is audit-logged.
 *
 *           Body: `{ success: false, message }`. The `message` is
 *           developer-oriented: it quotes raw status tokens and the role, and
 *           lists the statuses allowed from the current state. It is not
 *           written for end users. Re-fetch the order to refresh
 *           `allowedActions`.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Error' }
 *             example:
 *               success: false
 *               message: "Illegal transition 'delivered' → 'cancelled' for role 'seller'. Allowed from 'delivered': none"
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
/**
 * @swagger
 * /api/store/popular:
 *   get:
 *     summary: Get popular sellers (alias)
 *     description: |
 *       Same handler and response as `GET /api/sellers/popular` — see that
 *       endpoint for the full response. Hidden and suspended shops are never listed.
 *     tags:
 *       - Stores
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Only sellers with products in this category
 *     responses:
 *       200:
 *         description: Popular sellers
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
 * /api/store/{id}:
 *   get:
 *     summary: Get a single store (public storefront view)
 *     description: |
 *       Public view of a shop. 404 when the shop is hidden by its seller or
 *       suspended. Owner-only fields (ownerNIN, bankDetails, subAccountDetails,
 *       balance, history) are never included — the owner uses GET /api/store/my-store.
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
 *                 image:
 *                   type: string
 *                 description:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 email:
 *                   type: string
 *                 owner:
 *                   type: string
 *                 address:
 *                   type: string
 *                 city:
 *                   type: string
 *                 state:
 *                   type: string
 *                 location:
 *                   type: object
 *                 rating:
 *                   type: object
 *                 openingHours:
 *                   $ref: '#/components/schemas/StoreOpeningHours'
 *                 isOpenNow:
 *                   type: boolean
 *                   nullable: true
 *                   description: Open right now by its own hours (display only)
 *                 fulfilmentOptions:
 *                   type: array
 *                   items:
 *                     type: string
 *                     enum: [delivery, pickup]
 *       400:
 *         description: Invalid store ID
 *       404:
 *         description: Store not found, hidden or suspended
 */
router.get("/:id", getAStore);

module.exports = router;
