const express = require("express");
const {
  initializePayment,
  verifyPayment,
  getPaymentStatus,
  refundPayment,
  commissionHandler,
  generatePaymentReceipt,
  generateTransactionStatement,
  generateVATReport
} = require("../controllers/paymentController");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * /payment/initialize:
 *   post:
 *     summary: Initialize payment with Flutterwave
 *     description: Initialize payment for an order using Flutterwave
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
 *                     flw_ref:
 *                       type: string
 *                     orderId:
 *                       type: string
 *                     amount:
 *                       type: number
 *       400:
 *         description: Invalid request or order already paid
 *       404:
 *         description: Order not found
 */
router.post("/initialize", authMiddleware, initializePayment);

/**
 * @swagger
 * /payment/verify:
 *   post:
 *     summary: Verify payment status
 *     description: Verify payment status with Flutterwave after payment
 *     tags:
 *       - Payment
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transaction_id
 *               - orderId
 *             properties:
 *               transaction_id:
 *                 type: string
 *                 description: Flutterwave transaction ID
 *               orderId:
 *                 type: string
 *                 description: Order ID
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
 *                         transaction_id:
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
 *         description: Payment verification failed
 */
router.post("/verify", verifyPayment);

/**
 * @swagger
 * /payment/status/{orderId}:
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
 * /payment/refund:
 *   post:
 *     summary: Process refund
 *     description: Process refund for an order (Admin only)
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
 *                 description: Order ID to refund
 *               amount:
 *                 type: number
 *                 description: Refund amount (optional, defaults to full amount)
 *               reason:
 *                 type: string
 *                 description: Refund reason
 *     responses:
 *       200:
 *         description: Refund processed successfully
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
 *                     refund_id:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     status:
 *                       type: string
 *       400:
 *         description: Invalid request or order not paid
 *       403:
 *         description: Access denied - admin only
 */
router.post("/refund", authMiddleware, isAdmin, refundPayment);

/**
 * @swagger
 * /payment/commissions:
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
 * /payment/receipt/{orderId}:
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
 * /payment/statement:
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
 * /payment/vat-report:
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

module.exports = router;
