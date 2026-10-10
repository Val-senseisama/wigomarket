const express = require("express");
const rateLimit = require("express-rate-limit");
const { createSupportRequest } = require("../controllers/support");
const { optionalAuthMiddleware } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * Spam guard for the public contact form: 5 accepted submissions per hour per
 * account, or per sender email for guests. Guests are not keyed by IP: the app
 * sits behind the host's proxy without `trust proxy`, so req.ip is the proxy's
 * address and every guest would share a single bucket. Rejected (4xx)
 * submissions don't count, so fixing a typo in the form never locks anyone out.
 */
const supportRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => {
    if (req.user?._id) return `user:${req.user._id}`;
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    return email ? `email:${email}` : `ip:${req.ip}`;
  },
  skipFailedRequests: true,
  message: {
    success: false,
    message: "Too many support requests. Please try again in an hour.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @swagger
 * /api/support/requests:
 *   post:
 *     summary: Submit a support request
 *     description: >
 *       The "Contact support" form. Works for guests and signed-in users — send
 *       a bearer token to link the request to the account. The request is
 *       stored, the support team is emailed, and the sender receives an
 *       acknowledgement email quoting the reference. Limited to 5 accepted
 *       submissions per hour per account (or per email for guests).
 *     tags:
 *       - Support
 *     security:
 *       - {}
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - phone
 *               - message
 *             properties:
 *               firstName:
 *                 type: string
 *                 maxLength: 50
 *                 example: Ada
 *               lastName:
 *                 type: string
 *                 maxLength: 50
 *                 example: Obi
 *               email:
 *                 type: string
 *                 format: email
 *                 example: ada@example.com
 *               phone:
 *                 type: string
 *                 description: Local (0801...) or international (+234...) form; stored as 234XXXXXXXXXX for Nigerian numbers.
 *                 example: "+2348012345678"
 *               message:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 2000
 *                 example: I was charged twice for order #WM-1042.
 *     responses:
 *       201:
 *         description: Support request received
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Your support request has been received. We'll respond within 24 hours.
 *                 data:
 *                   type: object
 *                   properties:
 *                     reference:
 *                       type: string
 *                       example: SR-7K2Q9XHD
 *                     status:
 *                       type: string
 *                       enum: [open, in_progress, resolved]
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: >
 *           Validation failed — missing field, name over 50 characters, invalid
 *           email or phone, or message outside 10–2000 characters.
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
 *                   example: A valid email address is required
 *       429:
 *         description: Too many support requests
 */
router.post("/requests", optionalAuthMiddleware, supportRequestLimiter, createSupportRequest);

module.exports = router;
