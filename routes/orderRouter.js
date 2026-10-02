const express = require("express");
const {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  confirmDelivery,
} = require("../controllers/order");
const {
  getRefundable,
  createRefundRequest,
  listMyRefundRequests,
  getMyRefundRequest,
  escalateRefundRequest,
  withdrawRefundRequest,
} = require("../controllers/refund/buyer");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Order management
 *   - name: Refunds
 *     description: Buyer → seller refund requests, with admin escalation
 */

/**
 * @swagger
 * /api/order/create:
 *   post:
 *     summary: Create a new order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - paymentMethod
 *               - deliveryMethod
 *               - deliveryAddress
 *             properties:
 *               paymentMethod:
 *                 type: string
 *               deliveryMethod:
 *                 type: string
 *               deliveryAddress:
 *                 type: object
 *               deliveryNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order created successfully
 *       400:
 *         description: Bad request
 */
router.post("/create", authMiddleware, createOrder);

/**
 * @swagger
 * /api/order/my-orders:
 *   get:
 *     summary: Get logged-in user's orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of orders
 */
router.get("/my-orders", authMiddleware, getOrders);

// ── Refund requests (buyer) ─────────────────────────────────────────────────
// Declared before GET /:id so "refund-requests" is not taken for an order id.

/**
 * @swagger
 * /api/order/refund-requests:
 *   get:
 *     summary: The buyer's refund requests
 *     description: |
 *       Every refund request the logged-in buyer has made, newest first. Pass
 *       `orderId` to show the requests on one order's detail screen.
 *
 *       **How refunds work.** Money reaches the seller as soon as an order is
 *       paid, so the buyer asks the *seller* for a refund of that seller's
 *       items (`POST /api/order/{id}/refund-requests`). The seller has 3 days to
 *       approve or reject. If they reject — or don't answer in time — the buyer
 *       can escalate to WigoMarket, whose decision is final. Approved refunds go
 *       back to the card the buyer paid with.
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: orderId
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *         description: One or more comma-separated raw statuses (see RefundRequest.status)
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
 *       400:
 *         description: Invalid orderId or status
 *
 * components:
 *   schemas:
 *     RefundPagination:
 *       type: object
 *       properties:
 *         total: { type: integer }
 *         page: { type: integer }
 *         limit: { type: integer }
 *         pages: { type: integer }
 *     RefundRequest:
 *       type: object
 *       description: |
 *         A refund request for one seller's items in one order. Seller and admin
 *         views add `vendorAmount`/`platformAmount`; the admin view adds payout
 *         internals (`providerRefundId`, `lastError`, `shortfalls`, full `history`).
 *       properties:
 *         id: { type: string }
 *         orderId: { type: string }
 *         orderNumber: { type: string, nullable: true, example: "#WM1201" }
 *         store:
 *           type: object
 *           properties:
 *             id: { type: string }
 *             name: { type: string, nullable: true }
 *         buyer:
 *           type: object
 *           properties:
 *             id: { type: string }
 *             name: { type: string, nullable: true }
 *         items:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               productId: { type: string }
 *               title: { type: string }
 *               quantity: { type: integer }
 *               unitPrice: { type: number, description: What the buyer paid per unit }
 *         amount: { type: number, description: Naira refunded to the buyer (what they paid for these items; delivery fee excluded) }
 *         vendorAmount: { type: number, description: "Seller/admin only: taken back from the seller's wallet" }
 *         platformAmount: { type: number, description: "Seller/admin only: platform margin returned" }
 *         currency: { type: string, example: NGN }
 *         reason:
 *           type: string
 *           enum: [damaged, wrong_item, missing_items, not_as_described, not_delivered, order_cancelled, other]
 *         reasonLabel: { type: string, example: Item arrived damaged }
 *         details: { type: string, nullable: true }
 *         status:
 *           type: string
 *           description: |
 *             Raw state. Decision: `requested` (awaiting seller), `rejected`
 *             (by seller; buyer may escalate), `escalated` (awaiting admin),
 *             `declined` (by admin; final), `withdrawn` (by buyer). Payout:
 *             `approved` → `processing` → `provider_succeeded` → `settled`,
 *             with `failed`/`needs_review` handled by admins. Buyers and
 *             sellers should render `statusLabel`.
 *           enum: [requested, rejected, escalated, declined, withdrawn, approved, processing, provider_succeeded, settled, failed, needs_review]
 *         statusLabel:
 *           type: string
 *           description: Display status for this viewer. Buyers and sellers see every payout state as "Refund in progress" until "Refunded".
 *           example: Awaiting seller
 *         respondBy: { type: string, format: date-time, description: Seller's deadline; after it the buyer may escalate }
 *         sellerResponse:
 *           type: object
 *           nullable: true
 *           properties:
 *             decision: { type: string, enum: [approved, rejected] }
 *             note: { type: string, nullable: true }
 *             at: { type: string, format: date-time }
 *         escalation:
 *           type: object
 *           nullable: true
 *           properties:
 *             note: { type: string, nullable: true }
 *             at: { type: string, format: date-time }
 *         adminDecision:
 *           type: object
 *           nullable: true
 *           properties:
 *             decision: { type: string, enum: [approved, declined] }
 *             note: { type: string, nullable: true }
 *             at: { type: string, format: date-time }
 *         approvedBy: { type: string, enum: [seller, admin], nullable: true }
 *         settledAt: { type: string, format: date-time, nullable: true, description: When the refund was sent and booked }
 *         allowedActions:
 *           type: array
 *           description: |
 *             What this viewer can do now — render one button per entry.
 *             Buyer: `escalate`, `withdraw`. Seller: `approve`, `reject`.
 *             Admin: `approve`, `decline`, `resolve_refunded`, `resolve_not_refunded`, `retry`.
 *           items: { type: string }
 *         history:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               status: { type: string }
 *               at: { type: string, format: date-time }
 *               note: { type: string, nullable: true }
 *               role: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 */
router.get("/refund-requests", authMiddleware, listMyRefundRequests);

/**
 * @swagger
 * /api/order/refund-requests/{requestId}:
 *   get:
 *     summary: One of the buyer's refund requests
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
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
 *         description: Not found, or not this buyer's
 */
router.get("/refund-requests/:requestId", authMiddleware, getMyRefundRequest);

/**
 * @swagger
 * /api/order/refund-requests/{requestId}/escalate:
 *   post:
 *     summary: Ask WigoMarket to review a refund request
 *     description: |
 *       Allowed when the seller rejected the request, or has not answered by
 *       `respondBy`. An admin then approves or declines; that decision is final.
 *       Shown as `escalate` in `allowedActions` when allowed.
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note: { type: string, description: Why the buyer disagrees }
 *     responses:
 *       200:
 *         description: Escalated
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
 *         description: Not found, or not this buyer's
 *       409:
 *         description: Not escalatable yet (seller still has time) or in a state that cannot be escalated
 */
router.post("/refund-requests/:requestId/escalate", authMiddleware, escalateRefundRequest);

/**
 * @swagger
 * /api/order/refund-requests/{requestId}/withdraw:
 *   post:
 *     summary: Withdraw a refund request
 *     description: Allowed until the request is approved or declined. Frees the buyer to make a new request for that seller.
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Withdrawn
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
 *         description: Not found, or not this buyer's
 *       409:
 *         description: Already approved, declined, withdrawn or refunded
 */
router.post("/refund-requests/:requestId/withdraw", authMiddleware, withdrawRefundRequest);

/**
 * @swagger
 * /api/order/{id}/refundable:
 *   get:
 *     summary: What the buyer can still request a refund for, per seller
 *     description: |
 *       Backs the refund request form. For each seller in the order: their
 *       items with how many units were bought, already refunded (or in an open
 *       request), and still refundable; whether a request can be made now and,
 *       if not, why. Also returns the reason options.
 *
 *       Refunds can be requested for paid orders, at any stage, up to 7 days
 *       after delivery. One open request per seller per order at a time.
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
 *         description: Refundable items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     orderId: { type: string }
 *                     eligible: { type: boolean, description: Whether the order can be refunded at all right now }
 *                     reason: { type: string, nullable: true, description: Why not, when eligible is false }
 *                     refundWindowDays: { type: integer, example: 7 }
 *                     reasons:
 *                       type: array
 *                       description: Options for the reason dropdown
 *                       items:
 *                         type: object
 *                         properties:
 *                           value: { type: string, example: damaged }
 *                           label: { type: string, example: Item arrived damaged }
 *                     stores:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           storeId: { type: string }
 *                           storeName: { type: string, nullable: true }
 *                           canRequest: { type: boolean }
 *                           reason: { type: string, nullable: true, description: Why canRequest is false }
 *                           openRequestId: { type: string, nullable: true }
 *                           items:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 productId: { type: string }
 *                                 title: { type: string }
 *                                 image: { type: string, nullable: true }
 *                                 unitPrice: { type: number, description: What the buyer paid per unit }
 *                                 purchased: { type: integer }
 *                                 refundedOrRequested: { type: integer }
 *                                 refundable: { type: integer }
 *       404:
 *         description: Order not found, or not this buyer's
 */
router.get("/:id/refundable", authMiddleware, getRefundable);

/**
 * @swagger
 * /api/order/{id}/refund-requests:
 *   post:
 *     summary: Request a refund from a seller
 *     description: |
 *       Asks one seller to refund some or all of their items in this order. The
 *       buyer gets back what they paid for those items (the delivery fee is not
 *       refunded), to the card they paid with, once the seller — or, on
 *       escalation, an admin — approves.
 *
 *       The seller is notified and has 3 days to respond (`respondBy`).
 *     tags: [Refunds]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Order id
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               storeId:
 *                 type: string
 *                 description: The seller to ask. Required when the order has items from more than one seller.
 *               items:
 *                 type: array
 *                 description: Which items and how many. Omit to request everything still refundable from this seller.
 *                 items:
 *                   type: object
 *                   required: [productId, quantity]
 *                   properties:
 *                     productId: { type: string }
 *                     quantity: { type: integer, minimum: 1 }
 *               reason:
 *                 type: string
 *                 enum: [damaged, wrong_item, missing_items, not_as_described, not_delivered, order_cancelled, other]
 *               details:
 *                 type: string
 *                 maxLength: 2000
 *           example:
 *             storeId: "66fa0b1e9b1e8a0012ab2222"
 *             items: [{ productId: "66fa0b1e9b1e8a0012ab1111", quantity: 1 }]
 *             reason: damaged
 *             details: "The pack was torn open when it arrived."
 *     responses:
 *       201:
 *         description: Request created; the seller has been notified
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
 *         description: Invalid reason, storeId, product or quantity; or storeId missing on a multi-seller order
 *       404:
 *         description: Order not found, or not this buyer's
 *       409:
 *         description: Order not paid / already fully refunded / past the 7-day window, an open request already exists for this seller, or nothing left to refund
 */
router.post("/:id/refund-requests", authMiddleware, createRefundRequest);

/**
 * @swagger
 * /api/order/{id}:
 *   get:
 *     summary: Get order by ID
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found
 */
router.get("/:id", authMiddleware, getOrderById);

/**
 * @swagger
 * /api/order/{id}/status:
 *   put:
 *     summary: Update order status (Admin override)
 *     description: |
 *       Admin override for the order state machine. Admins may perform any valid
 *       transition between canonical states; the same engine that enforces
 *       seller/rider rules validates the request. Cancellation restores stock and
 *       reconciles payment status, and the change is written atomically with an
 *       audit Transaction record.
 *
 *       Canonical states: `pending`, `confirmed`, `preparing`, `pickUpReady`,
 *       `inTransit`, `delivered`, `cancelled`.
 *
 *       This endpoint enforces role-based order status transitions. Sellers may
 *       only update orders through the allowed flow
 *       (`pending` → `confirmed` → `preparing` → `pickUpReady`); riders handle
 *       delivery-stage transitions. Direct or non-sequential status updates are
 *       rejected (HTTP 422).
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, confirmed, preparing, pickUpReady, inTransit, delivered, cancelled]
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 *       400:
 *         description: Missing or invalid status value
 *       422:
 *         description: Illegal transition
 */
router.put("/:id/status", authMiddleware, isAdmin, updateOrderStatus);

/**
 * @swagger
 * /api/order/confirm-delivery:
 *   post:
 *     summary: Customer confirms delivery receipt
 *     description: |
 *       Called by the customer when they physically receive their order.
 *       If the delivery agent has already confirmed on their end, the agent's
 *       earnings are credited immediately and both parties are notified by email (sent via background queue).
 *       If the agent has not yet confirmed, the customer's confirmation is recorded
 *       and earnings will be credited once the agent confirms.
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: string
 *                 description: ID of the order being confirmed
 *     responses:
 *       200:
 *         description: Confirmation recorded
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
 *                   properties:
 *                     credited:
 *                       type: boolean
 *                     amount:
 *                       type: number
 *                     walletBalance:
 *                       type: number
 *                     reason:
 *                       type: string
 *       400:
 *         description: orderId missing, order already delivered, or order does not belong to user
 *       401:
 *         description: Unauthorized
 */
router.post("/confirm-delivery", authMiddleware, confirmDelivery);

module.exports = router;
