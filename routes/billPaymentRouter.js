const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/authMiddleware");
const {
  getDataPlans,
  getServiceVariations,
  verifyMeter,
  verifyDecoder,
  purchaseAirtime,
  purchaseData,
  payElectricity,
  payCableTv,
  getMyBillPayments,
  requeryBillPayment,
  handleVtpassWebhook,
} = require("../controllers/billPaymentController");

// ── Service discovery (no wallet required) ──────────────────────────────────

/**
 * @swagger
 * /api/bills/plans/data:
 *   get:
 *     summary: Get data plans for a network
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: network
 *         required: true
 *         schema:
 *           type: string
 *           enum: [mtn, airtel, glo, glo-sme, etisalat, smile-direct, spectranet]
 *     responses:
 *       200:
 *         description: Data plans retrieved
 */
router.get("/plans/data", authMiddleware, getDataPlans);

/**
 * @swagger
 * /api/bills/plans/{serviceId}:
 *   get:
 *     summary: Get service variations (cable TV packages, etc.)
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: serviceId
 *         required: true
 *         schema:
 *           type: string
 *         description: VTpass service ID (e.g. dstv, gotv, startimes)
 *     responses:
 *       200:
 *         description: Service variations retrieved
 */
router.get("/plans/:serviceId", authMiddleware, getServiceVariations);

/**
 * @swagger
 * /api/bills/verify/meter:
 *   get:
 *     summary: Verify an electricity meter number
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: provider
 *         required: true
 *         schema: { type: string }
 *         description: e.g. ikeja-electric, eko-electric
 *       - in: query
 *         name: meter_number
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: meter_type
 *         schema:
 *           type: string
 *           enum: [prepaid, postpaid]
 *           default: prepaid
 *     responses:
 *       200:
 *         description: Meter verified successfully
 *       400:
 *         description: Verification failed
 */
router.get("/verify/meter", authMiddleware, verifyMeter);

/**
 * @swagger
 * /api/bills/verify/decoder:
 *   get:
 *     summary: Verify a cable TV smartcard / decoder number
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: provider
 *         required: true
 *         schema:
 *           type: string
 *           enum: [dstv, gotv, startimes, showmax]
 *       - in: query
 *         name: smartcard_number
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Decoder verified successfully
 */
router.get("/verify/decoder", authMiddleware, verifyDecoder);

// ── Purchase endpoints ──────────────────────────────────────────────────────

/**
 * @swagger
 * /api/bills/airtime:
 *   post:
 *     summary: Purchase airtime from wallet
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [network, phone, amount]
 *             properties:
 *               network:
 *                 type: string
 *                 enum: [mtn, glo, airtel, etisalat]
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               amount:
 *                 type: number
 *                 minimum: 50
 *     responses:
 *       200:
 *         description: Initial wallet debit successful; purchase offloaded to background queue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Airtime purchase is processing" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     request_id: { type: string, example: "20240405123456" }
 *                     status: { type: string, example: "processing" }
 *                     network: { type: string, example: "mtn" }
 *                     phone: { type: string, example: "08012345678" }
 *                     amount: { type: number, example: 100 }
 *       400:
 *         description: Validation error or insufficient balance
 */
router.post("/airtime", authMiddleware, purchaseAirtime);

/**
 * @swagger
 * /api/bills/data:
 *   post:
 *     summary: Purchase a data bundle from wallet
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [network, phone, variation_code]
 *             properties:
 *               network:
 *                 type: string
 *                 enum: [mtn, airtel, glo, etisalat]
 *               phone:
 *                 type: string
 *               variation_code:
 *                 type: string
 *                 description: From GET /api/bills/plans/data
 *     responses:
 *       200:
 *         description: Initial wallet debit successful; data bundle purchase offloaded to background queue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "MTN 1GB data purchase is processing" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     request_id: { type: string, example: "20240405123456" }
 *                     status: { type: string, example: "processing" }
 *                     network: { type: string, example: "mtn" }
 *                     phone: { type: string, example: "08012345678" }
 *                     amount: { type: number, example: 500 }
 */
router.post("/data", authMiddleware, purchaseData);

/**
 * @swagger
 * /api/bills/electricity:
 *   post:
 *     summary: Pay electricity bill from wallet
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, meter_number, amount, phone]
 *             properties:
 *               provider:
 *                 type: string
 *                 example: ikeja-electric
 *               meter_number:
 *                 type: string
 *               meter_type:
 *                 type: string
 *                 enum: [prepaid, postpaid]
 *                 default: prepaid
 *               amount:
 *                 type: number
 *                 minimum: 100
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Initial wallet debit successful; electricity payment offloaded to background queue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "Electricity payment is processing" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     request_id: { type: string, example: "20240405123456" }
 *                     status: { type: string, example: "processing" }
 *                     provider: { type: string, example: "ikeja-electric" }
 *                     meter_number: { type: string, example: "01234567890" }
 *                     amount: { type: number, example: 1000 }
 */
router.post("/electricity", authMiddleware, payElectricity);

/**
 * @swagger
 * /api/bills/cable-tv:
 *   post:
 *     summary: Pay cable TV subscription from wallet
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [provider, smartcard_number, variation_code, phone]
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [dstv, gotv, startimes, showmax]
 *               smartcard_number:
 *                 type: string
 *               variation_code:
 *                 type: string
 *                 description: From GET /api/bills/plans/:serviceId
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Initial wallet debit successful; subscription offloaded to background queue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: "DSTV payment is processing" }
 *                 data:
 *                   type: object
 *                   properties:
 *                     request_id: { type: string, example: "20240405123456" }
 *                     status: { type: string, example: "processing" }
 *                     provider: { type: string, example: "dstv" }
 *                     smartcard_number: { type: string, example: "0123456789" }
 *                     amount: { type: number, example: 5000 }
 */
router.post("/cable-tv", authMiddleware, payCableTv);

// ── History & requery ───────────────────────────────────────────────────────

/**
 * @swagger
 * /api/bills/history:
 *   get:
 *     summary: Get my bill payment history
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: serviceType
 *         schema:
 *           type: string
 *           enum: [airtime, data, electricity, cable_tv]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Bill payment history
 */
router.get("/history", authMiddleware, getMyBillPayments);

/**
 * @swagger
 * /api/bills/requery/{requestId}:
 *   get:
 *     summary: Manually requery a pending bill payment
 *     tags: [Bills]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated status (and token if electricity)
 */
router.get("/requery/:requestId", authMiddleware, requeryBillPayment);

/**
 * @swagger
 * /api/bills/webhook/vtpass:
 *   post:
 *     summary: VTpass status push notification
 *     tags: [Bills]
 *     description: Real-time update from VTpass. No authentication (IP whitelist recommended).
 *     responses:
 *       200:
 *         description: Webhook received
 */
router.post("/webhook/vtpass", handleVtpassWebhook);

module.exports = router;
