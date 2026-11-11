const express = require("express");
const {
  addFavouriteStore,
  removeFavouriteStore,
  getFavouriteStores,
} = require("../controllers/favouriteStoreController");
const { authMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Favourites
 *   description: Favourite (saved) vendors — the heart on a vendor card
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     FavouriteStoreToggleResult:
 *       type: object
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string }
 *         data:
 *           type: object
 *           properties:
 *             storeId: { type: string }
 *             isFavourite:
 *               type: boolean
 *               description: The shop's saved state after the call — set the heart from this.
 *             totalItems: { type: integer, description: Number of shops now saved }
 * /api/favourites/stores:
 *   get:
 *     summary: Favourite vendors screen
 *     description: >
 *       The signed-in user's favourite shops as vendor cards — the same fields as
 *       GET /api/home/popular-vendors — most recently saved first. Shops that are
 *       hidden or suspended are left out but stay saved and reappear if restored.
 *       Pass lat/lng to get distanceKm and travelTimeMin.
 *     tags: [Favourites]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *       - in: query
 *         name: lat
 *         schema: { type: number }
 *       - in: query
 *         name: lng
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: One page of favourite shops
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     allOf:
 *                       - $ref: '#/components/schemas/StoreCard'
 *                       - type: object
 *                         properties:
 *                           savedAt: { type: string, format: date-time }
 *                 pagination: { $ref: '#/components/schemas/Pagination' }
 *       401:
 *         description: Not signed in
 */
router.get("/stores", authMiddleware, getFavouriteStores);

/**
 * @swagger
 * /api/favourites/stores/{storeId}:
 *   put:
 *     summary: Save a vendor as favourite (heart on)
 *     description: >
 *       Idempotent — saving a shop that is already saved returns 200 with the
 *       same body, so double taps are harmless. Every vendor card
 *       (top-shops, nearby-shops, popular-vendors, search) and GET /api/store/{id}
 *       report the result as `isFavourite` when the bearer token is sent.
 *     tags: [Favourites]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The shop is saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FavouriteStoreToggleResult' }
 *             example:
 *               success: true
 *               message: "Store added to favourites"
 *               data: { storeId: "66c1a2b3c4d5e6f708192a01", isFavourite: true, totalItems: 4 }
 *       400:
 *         description: Invalid store id
 *       404:
 *         description: Store not found (or hidden from the storefront)
 *   delete:
 *     summary: Remove a vendor from favourites (heart off)
 *     description: Idempotent — removing a shop that is not saved returns 200.
 *     tags: [Favourites]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: storeId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The shop is not saved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/FavouriteStoreToggleResult' }
 *       400:
 *         description: Invalid store id
 */
router.put("/stores/:storeId", authMiddleware, addFavouriteStore);
router.delete("/stores/:storeId", authMiddleware, removeFavouriteStore);

module.exports = router;
