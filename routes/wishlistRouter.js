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
const { authMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * /api/wishlist/add:
 *   post:
 *     summary: Add product to wishlist
 *     description: Add a product to the authenticated user's wishlist
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
 *                 description: ID of the product to add to wishlist
 *                 example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *               notes:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional notes for the product
 *                 example: "Want this for birthday gift"
 *     responses:
 *       200:
 *         description: Product added to wishlist successfully
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
 *                   example: "Product added to wishlist successfully"
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
 *                         totalItems:
 *                           type: number
 *                         products:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               product:
 *                                 type: object
 *                                 properties:
 *                                   _id:
 *                                     type: string
 *                                   title:
 *                                     type: string
 *                                   price:
 *                                     type: number
 *                                   images:
 *                                     type: array
 *                                     items:
 *                                       type: string
 *                                   store:
 *                                     type: object
 *                                     properties:
 *                                       _id:
 *                                         type: string
 *                                       name:
 *                                         type: string
 *                               addedAt:
 *                                 type: string
 *                                 format: date-time
 *                               notes:
 *                                 type: string
 *                     addedProduct:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         title:
 *                           type: string
 *                         price:
 *                           type: number
 *       400:
 *         description: Invalid product ID or product already in wishlist
 *       404:
 *         description: Product not found
 */
router.post("/add", authMiddleware, addToWishlist);

/**
 * @swagger
 * /api/wishlist/remove/{productId}:
 *   delete:
 *     summary: Remove product from wishlist
 *     description: Remove a product from the authenticated user's wishlist
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
 *         description: ID of the product to remove from wishlist
 *         example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *     responses:
 *       200:
 *         description: Product removed from wishlist successfully
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
 *                   example: "Product removed from wishlist successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     wishlist:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         totalItems:
 *                           type: number
 *                         products:
 *                           type: array
 *       400:
 *         description: Invalid product ID or product not in wishlist
 *       404:
 *         description: Wishlist not found
 */
router.delete("/remove/:productId", authMiddleware, removeFromWishlist);

/**
 * @swagger
 * /api/wishlist:
 *   get:
 *     summary: Get user's wishlist
 *     description: Get the authenticated user's wishlist with pagination
 *     tags:
 *       - Wishlist
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: Wishlist retrieved successfully
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
 *                   example: "Wishlist retrieved successfully"
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
 *                         lastUpdated:
 *                           type: string
 *                           format: date-time
 *                         products:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               product:
 *                                 type: object
 *                                 properties:
 *                                   _id:
 *                                     type: string
 *                                   title:
 *                                     type: string
 *                                   price:
 *                                     type: number
 *                                   listedPrice:
 *                                     type: number
 *                                   images:
 *                                     type: array
 *                                     items:
 *                                       type: string
 *                                   category:
 *                                     type: object
 *                                     properties:
 *                                       _id:
 *                                         type: string
 *                                       name:
 *                                         type: string
 *                                   store:
 *                                     type: object
 *                                     properties:
 *                                       _id:
 *                                         type: string
 *                                       name:
 *                                         type: string
 *                                       address:
 *                                         type: object
 *                               addedAt:
 *                                 type: string
 *                                 format: date-time
 *                               notes:
 *                                 type: string
 *                         pagination:
 *                           type: object
 *                           properties:
 *                             currentPage:
 *                               type: number
 *                             totalPages:
 *                               type: number
 *                             totalItems:
 *                               type: number
 *                             hasNext:
 *                               type: boolean
 *                             hasPrev:
 *                               type: boolean
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
 *     responses:
 *       200:
 *         description: Public wishlist retrieved successfully
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
 *                   example: "Public wishlist retrieved successfully"
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
 *                         totalItems:
 *                           type: number
 *                         products:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               product:
 *                                 type: object
 *                                 properties:
 *                                   _id:
 *                                     type: string
 *                                   title:
 *                                     type: string
 *                                   price:
 *                                     type: number
 *                                   images:
 *                                     type: array
 *                                     items:
 *                                       type: string
 *                               addedAt:
 *                                 type: string
 *                                 format: date-time
 *       400:
 *         description: Invalid user ID
 *       404:
 *         description: Public wishlist not found
 */
router.get("/public/:userId", getPublicWishlist);

module.exports = router;
