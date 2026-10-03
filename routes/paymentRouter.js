const express = require("express");
const {
  initializePayment,
  verifyPayment,
  getPaymentStatus,
  commissionHandler,
  generatePaymentReceipt,
  generateTransactionStatement,
  generateVATReport,
} = require("../controllers/payment");
const { handlePaymentWebhook } = require("../controllers/webhookController");
const { runPendingPaymentCheck } = require("../services/pendingPaymentCron");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const rateLimit = require("express-rate-limit");
const router = express.Router();

/**
 * Rate limiter for payment initialisation.
 * Keyed by authenticated user ID to prevent card-testing attacks.
 * 10 attempts per 15-minute window per user.
 */
const paymentInitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: {
    success: false,
    message: "Too many payment attempts. Please try again after 15 minutes.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

/**
 * @swagger
 * /api/payment/webhook/{provider}:
 *   post:
 *     summary: Payment provider webhook
 *     description: |
 *       Receives payment events from a payment provider. Configure each
 *       provider's dashboard to call its own URL:
 *
 *       - Monnify: `/api/payment/webhook/monnify` — signed with `monnify-signature`
 *         (HMAC-SHA512 of the raw body, keyed with the Monnify secret key).
 *         Acts on `SUCCESSFUL_TRANSACTION` (order payments) and
 *         `SUCCESSFUL_DISBURSEMENT` / `FAILED_DISBURSEMENT` /
 *         `REVERSED_DISBURSEMENT` (withdrawal payouts).
 *       - Flutterwave: `/api/payment/webhook/flutterwave` (or the legacy
 *         `/api/payment/webhook`) — `verif-hash` must equal `FLW_WEBHOOK_SECRET_HASH`.
 *         Acts on `charge.completed` and `transfer.completed`.
 *
 *       The endpoint acknowledges at once and processes in the background.
 *       Every event is re-verified with the provider's API by our own
 *       reference before anything is booked: each charge marks its order paid
 *       exactly once, and each payout completes its withdrawal — or, if it
 *       failed or was reversed, returns amount + fee to the wallet — exactly
 *       once, however many times the event is delivered.
 *     tags:
 *       - Payment
 *     parameters:
 *       - in: path
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [monnify, flutterwave]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook received
 *       401:
 *         description: Invalid signature
 *       404:
 *         description: Unknown provider
 */
router.post("/webhook/:provider", handlePaymentWebhook);
router.post("/webhook", handlePaymentWebhook); // legacy Flutterwave URL

/**
 * @swagger
 * /api/payment/initialize:
 *   post:
 *     summary: Start checkout for an order
 *     description: |
 *       Opens a hosted checkout with the active payment provider (Monnify by
 *       default) and returns its URL. Each call opens a fresh checkout under a
 *       new `reference`, so a buyer who closed the tab can call it again.
 *       After paying, the buyer is sent to
 *       `FRONTEND_URL/payment/callback?orderId=<orderId>`; the client then
 *       calls `POST /api/payment/verify`.
 *     tags:
 *       - Payment
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
 *                 description: ID of the order to pay for
 *     responses:
 *       200:
 *         description: Payment initialized successfully
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
 *                     payment_url:
 *                       type: string
 *                       description: Hosted checkout page to send the buyer to
 *                     reference:
 *                       type: string
 *                       description: Our reference for this checkout attempt
 *                     provider:
 *                       type: string
 *                       enum: [monnify, flutterwave]
 *                     orderId:
 *                       type: string
 *                     amount:
 *                       type: number
 *       400:
 *         description: Invalid request or order already paid
 *       403:
 *         description: Order belongs to another user
 *       404:
 *         description: Order not found
 *       502:
 *         description: The payment provider could not start checkout
 */
router.post("/initialize", authMiddleware, paymentInitLimiter, initializePayment);

/**
 * @swagger
 * /api/payment/verify:
 *   post:
 *     summary: Verify payment status
 *     description: |
 *       Asks the order's payment provider about the order's own checkout
 *       references and, if the charge succeeded, marks the order paid and
 *       credits sellers (exactly once, shared with the webhook and the cron).
 *       Safe to call repeatedly.
 *     tags:
 *       - Payment
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
 *                 description: Order ID
 *               transaction_id:
 *                 type: string
 *                 deprecated: true
 *                 description: Ignored. The charge is looked up by the order's own references.
 *     responses:
 *       200:
 *         description: Payment verified successfully
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
 *                     order:
 *                       type: object
 *                     payment:
 *                       type: object
 *                       properties:
 *                         provider:
 *                           type: string
 *                           enum: [monnify, flutterwave]
 *                         transaction_id:
 *                           type: string
 *                           description: The provider's id for the charge
 *                         reference:
 *                           type: string
 *                         amount:
 *                           type: number
 *                         currency:
 *                           type: string
 *                         status:
 *                           type: string
 *                         paid_at:
 *                           type: string
 *                           format: date-time
 *       400:
 *         description: Checkout not started, payment not complete yet, or payment failed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [pending, failed]
 *                     providerStatus:
 *                       type: string
 *       404:
 *         description: Order not found
 *       409:
 *         description: Payment received but it does not match this order (amount or reference); admins are alerted
 */
router.post("/verify", verifyPayment);

/**
 * @swagger
 * /api/payment/status/{orderId}:
 *   get:
 *     summary: Get payment status
 *     description: Get payment status for an order
 *     tags:
 *       - Payment
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Payment status retrieved successfully
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
 *                     orderId:
 *                       type: string
 *                     paymentStatus:
 *                       type: string
 *                     orderStatus:
 *                       type: string
 *                     paymentIntent:
 *                       type: object
 *       404:
 *         description: Order not found
 */
router.get("/status/:orderId", authMiddleware, getPaymentStatus);

/**
 * @swagger
 * /api/payment/commissions:
 *   get:
 *     summary: Get commission breakdown
 *     description: Get commission breakdown for stores and platform
 *     tags:
 *       - Payment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Commission breakdown retrieved successfully
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
 *                     properties:
 *                       store:
 *                         type: object
 *                       storeCommission:
 *                         type: number
 *                       gomarketCommission:
 *                         type: number
 */
router.get("/commissions", authMiddleware, commissionHandler);

// Receipt and PDF Export Routes

/**
 * @swagger
 * /api/payment/receipt/{orderId}:
 *   get:
 *     summary: Generate payment receipt PDF
 *     description: Generate and download PDF receipt for a completed payment
 *     tags:
 *       - Payment
 *       - Receipts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID for which to generate receipt
 *     responses:
 *       200:
 *         description: PDF receipt generated and downloaded successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *             example: "PDF file content"
 *       400:
 *         description: Order not paid or invalid request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Receipt can only be generated for paid orders"
 *       403:
 *         description: Access denied - order doesn't belong to user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Access denied. This order doesn't belong to you."
 *       404:
 *         description: Order or transaction not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Order not found"
 *       500:
 *         description: Failed to generate or download receipt
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to download receipt"
 */
router.get("/receipt/:orderId", authMiddleware, generatePaymentReceipt);

/**
 * @swagger
 * /api/payment/statement:
 *   get:
 *     summary: Generate transaction statement PDF
 *     description: Generate and download PDF statement of user transactions
 *     tags:
 *       - Payment
 *       - Receipts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for statement (YYYY-MM-DD)
 *         example: "2024-01-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for statement (YYYY-MM-DD)
 *         example: "2024-01-31"
 *     responses:
 *       200:
 *         description: PDF statement generated and downloaded successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *             example: "PDF file content"
 *       404:
 *         description: No transactions found for the specified period
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "No transactions found for the specified period"
 *       500:
 *         description: Failed to generate or download statement
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to download statement"
 */
router.get("/statement", authMiddleware, generateTransactionStatement);

/**
 * @swagger
 * /api/payment/vat-report:
 *   get:
 *     summary: Generate VAT report PDF (Admin only)
 *     description: Generate and download PDF VAT report for admin users
 *     tags:
 *       - Payment
 *       - Receipts
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for VAT report (YYYY-MM-DD)
 *         example: "2024-01-01"
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for VAT report (YYYY-MM-DD)
 *         example: "2024-01-31"
 *     responses:
 *       200:
 *         description: PDF VAT report generated and downloaded successfully
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *             example: "PDF file content"
 *       403:
 *         description: Access denied - admin only
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Access denied. Admin privileges required."
 *       404:
 *         description: No VAT data found for the specified period
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "No VAT data found for the specified period"
 *       500:
 *         description: Failed to generate or download VAT report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Failed to download VAT report"
 */
router.get("/vat-report", authMiddleware, isAdmin, generateVATReport);

/**
 * @swagger
 * /api/payment/admin/run-pending-check:
 *   post:
 *     summary: Manually trigger pending payment recovery (Admin only)
 *     description: |
 *       Runs the same logic as the 5-minute cron — asks the payment provider
 *       about every unpaid checkout started in the last 48 hours and books any
 *       that are now confirmed paid.
 *       Idempotent and race-condition safe.
 *     tags:
 *       - Payment
 *       - Admin
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       403:
 *         description: Admin only
 */
router.post(
  "/admin/run-pending-check",
  authMiddleware,
  isAdmin,
  async (req, res) => {
    try {
      await runPendingPaymentCheck();
      res.json({ success: true, message: "Pending payment check completed" });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

module.exports = router;
