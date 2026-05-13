const express = require("express");
const router = express.Router();
const { generateSignature } = require("../controllers/uploadController");
const { authMiddleware } = require("../middleware/authMiddleware");

/**
 * @swagger
 * /api/upload/signature:
 *   post:
 *     summary: Generate a Cloudinary upload signature
 *     tags: [Upload]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               folder:
 *                 type: string
 *                 description: Optional folder name in Cloudinary
 *     responses:
 *       200:
 *         description: Signature generated successfully
 */
router.post("/signature", authMiddleware, generateSignature);

module.exports = router;
