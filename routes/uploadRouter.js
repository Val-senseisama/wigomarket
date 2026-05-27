const express = require("express");
const router = express.Router();
const { generateSignature } = require("../controllers/uploadController");
const { authMiddleware } = require("../middleware/authMiddleware");

/**
 * @swagger
 * /api/upload/signature:
 *   post:
 *     summary: Generate a Cloudinary signed-upload signature
 *     description: |
 *       Returns the credentials needed for the client to upload a file **directly** to
 *       Cloudinary without routing the binary through this server.
 *
 *       ### 3-step upload flow
 *
 *       **Step 1 — Get a signature (this endpoint)**
 *       ```
 *       POST /api/upload/signature
 *       { "folder": "products" }
 *       → { timestamp, signature, cloudName, apiKey, folder }
 *       ```
 *
 *       **Step 2 — Upload straight to Cloudinary from the client**
 *       ```
 *       POST https://api.cloudinary.com/v1_1/<cloudName>/image/upload
 *       Content-Type: multipart/form-data
 *       file=<binary>
 *       api_key=<apiKey>
 *       timestamp=<timestamp>
 *       signature=<signature>
 *       folder=<folder>           ← must match what was signed in Step 1
 *       → { secure_url, public_id, … }   ← Cloudinary response
 *       ```
 *
 *       **Step 3 — Send the resulting URL to the API**
 *       Pass `secure_url` from the Cloudinary response as the image/document field in
 *       the relevant endpoint (e.g. `storeImage`, `images[]`, `documents.driverLicense.image`).
 *
 *       ### Valid folder names
 *       | Folder | Used for |
 *       |--------|----------|
 *       | `stores` | Store banner / logo (`storeImage`) |
 *       | `store-nin` | Store owner NIN image (`ownerNIN`) |
 *       | `products` | Product images (`images[]`) |
 *       | `dispatch-documents` | Rider documents — driver's licence, vehicle registration, NIN |
 *       | `profiles` | User profile photos (`image` in profile update) |
 *
 *       > The folder is optional but strongly recommended so that files are
 *       > organised and the server-side Cloudinary URL validator can enforce
 *       > the correct cloud account.
 *     tags:
 *       - Upload
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               folder:
 *                 type: string
 *                 description: Target Cloudinary folder (see table above)
 *                 enum: [stores, store-nin, products, dispatch-documents, profiles]
 *                 example: products
 *     responses:
 *       200:
 *         description: Signature generated — use these values in the Cloudinary upload request
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [timestamp, signature, cloudName, apiKey]
 *               properties:
 *                 timestamp:
 *                   type: integer
 *                   description: Unix timestamp (seconds) used to sign the request
 *                   example: 1716825600
 *                 signature:
 *                   type: string
 *                   description: HMAC-SHA256 signature to authenticate the Cloudinary upload
 *                   example: "a1b2c3d4e5f6..."
 *                 cloudName:
 *                   type: string
 *                   description: Your Cloudinary cloud name
 *                   example: "my-cloud"
 *                 apiKey:
 *                   type: string
 *                   description: Cloudinary API key (public — safe to expose)
 *                   example: "123456789012345"
 *                 folder:
 *                   type: string
 *                   description: Echo of the requested folder (omitted if not supplied)
 *                   example: "products"
 *       401:
 *         description: Unauthorised — valid bearer token required
 *       500:
 *         description: Failed to generate signature
 */
router.post("/signature", authMiddleware, generateSignature);

module.exports = router;
