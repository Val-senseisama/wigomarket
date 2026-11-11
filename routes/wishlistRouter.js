const express = require("express");
const {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  checkProductInWishlist,
  clearWishlist,
  updateWishlistSettings,
  getPublicWishlist
} = require("../controllers/wishlistController");
const { authMiddleware, optionalAuthMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/wishlist/add:
 *   post:
 *     summary: Save a product (the heart)
 *     description: >
 *       Saves a product for the signed-in user — the heart on a product card and
 *       the save button on the product page. Idempotent: saving a product that is
 *       already saved returns 200 with the same body, so double taps are harmless.
 *       Every product response (`get-products`, product detail, home
 *       suggested-products, search, GET /api/wishlist) reports the result as
 *       `isInWishlist`.
 *     tags:
 *       - Wishlist
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - productId
 *             properties:
 *               productId:
 *                 type: string
 *                 example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional note
 *     responses:
 *       200:
 *         description: Product is saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WishlistToggleResult'
 *             example:
 *               success: true
 *               message: "Product saved"
 *               data: { productId: "64f8a1b2c3d4e5f6a7b8c9d0", isInWishlist: true, totalItems: 3 }
 *       400:
 *         description: Invalid product ID
 *       404:
 *         description: Product not found (or hidden from the storefront)
 */
router.post("/add", authMiddleware, addToWishlist);

/**
 * @swagger
 * components:
 *   schemas:
 *     WishlistToggleResult:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data:
 *           type: object
 *           properties:
 *             productId: { type: string }
 *             isInWishlist:
 *               type: boolean
 *               description: The product's saved state after the call — set the heart from this.
 *             totalItems: { type: integer, description: Number of products now saved }
 *     SavedProductCard:
 *       allOf:
 *         - $ref: '#/components/schemas/ProductCard'
 *         - type: object
 *           properties:
 *             isInWishlist: { type: boolean, example: true }
 *             savedAt: { type: string, format: date-time, nullable: true }
 * /api/wishlist/remove/{productId}:
 *   delete:
 *     summary: Unsave a product
 *     description: >
 *       Removes a product from the signed-in user's saved products. Idempotent:
 *       removing a product that is not saved returns 200.
 *     tags:
 *       - Wishlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *     responses:
 *       200:
 *         description: Product is not saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WishlistToggleResult'
 *             example:
 *               success: true
 *               message: "Product removed from saved items"
 *               data: { productId: "64f8a1b2c3d4e5f6a7b8c9d0", isInWishlist: false, totalItems: 2 }
 *       400:
 *         description: Invalid product ID
 */
router.delete("/remove/:productId", authMiddleware, removeFromWishlist);

/**
 * @swagger
 * /api/wishlist:
 *   get:
 *     summary: Saved products screen
 *     description: >
 *       The signed-in user's saved products as product cards (the same shape as
 *       GET /api/product/get-products), most recently saved first. Products that
 *       are hidden, or whose shop is hidden or suspended, are left out but stay
 *       saved and reappear if restored. Out-of-stock products are included —
 *       check `displayStatus`.
 *     tags:
 *       - Wishlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: One page of saved products
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/SavedProductCard' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *                 wishlist:
 *                   type: object
 *                   properties:
 *                     _id: { type: string, nullable: true }
 *                     name: { type: string, example: "My Wishlist" }
 *                     isPublic: { type: boolean }
 *                     totalItems: { type: integer, description: Saved products currently visible }
 */
router.get("/", authMiddleware, getWishlist);

/**
 * @swagger
 * /api/wishlist/check/{productId}:
 *   get:
 *     summary: Check if product is in wishlist
 *     description: Check if a specific product is in the authenticated user's wishlist
 *     tags:
 *       - Wishlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the product to check
 *         example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *     responses:
 *       200:
 *         description: Product wishlist status retrieved
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
 *                   example: "Product wishlist status retrieved"
 *                 data:
 *                   type: object
 *                   properties:
 *                     productId:
 *                       type: string
 *                     isInWishlist:
 *                       type: boolean
 *       400:
 *         description: Invalid product ID
 */
router.get("/check/:productId", authMiddleware, checkProductInWishlist);

/**
 * @swagger
 * /api/wishlist/clear:
 *   delete:
 *     summary: Clear wishlist
 *     description: Remove all products from the authenticated user's wishlist
 *     tags:
 *       - Wishlist
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wishlist cleared successfully
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
 *                   example: "Wishlist cleared successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     wishlist:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         products:
 *                           type: array
 *                         totalItems:
 *                           type: number
 *       404:
 *         description: Wishlist not found
 */
router.delete("/clear", authMiddleware, clearWishlist);

/**
 * @swagger
 * /api/wishlist/settings:
 *   put:
 *     summary: Update wishlist settings
 *     description: Update wishlist name and privacy settings
 *     tags:
 *       - Wishlist
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 100
 *                 description: New wishlist name
 *                 example: "My Birthday Wishlist"
 *               isPublic:
 *                 type: boolean
 *                 description: Make wishlist public or private
 *                 example: true
 *     responses:
 *       200:
 *         description: Wishlist settings updated successfully
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
 *                   example: "Wishlist settings updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     wishlist:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         isPublic:
 *                           type: boolean
 *                         totalItems:
 *                           type: number
 *       404:
 *         description: Wishlist not found
 */
router.put("/settings", authMiddleware, updateWishlistSettings);

/**
 * @swagger
 * /api/wishlist/public/{userId}:
 *   get:
 *     summary: Get public wishlist
 *     description: Get a user's public wishlist by user ID
 *     tags:
 *       - Wishlist
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the user whose public wishlist to view
 *         example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Public wishlist retrieved successfully, as product cards
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: array
 *                   items: { $ref: '#/components/schemas/ProductCard' }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *                 wishlist:
 *                   type: object
 *                   properties:
 *                     _id: { type: string }
 *                     name: { type: string }
 *                     totalItems: { type: integer }
 *       400:
 *         description: Invalid user ID
 *       404:
 *         description: Public wishlist not found
 */
router.get("/public/:userId", optionalAuthMiddleware, getPublicWishlist);

module.exports = router;
