const express = require("express");
const {
  createRating,
  getDeliveryAgentRatings,
  getMyRatings,
  updateRating,
  deleteRating,
  reportRating
} = require("../controllers/ratingController");
const { authMiddleware } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * /rating:
 *   post:
 *     summary: Create rating and review
 *     description: Create a rating and review for a delivery agent
 *     tags:
 *       - Rating
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
 *               - rating
 *               - breakdown
 *             properties:
 *               orderId:
 *                 type: string
 *                 description: Order ID to rate
 *               rating:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 5
 *                 description: Overall rating (1-5)
 *               breakdown:
 *                 type: object
 *                 required:
 *                   - punctuality
 *                   - communication
 *                   - handling
 *                   - professionalism
 *                 properties:
 *                   punctuality:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   communication:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   handling:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   professionalism:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *               review:
 *                 type: string
 *                 maxLength: 500
 *                 description: Optional review text
 *     responses:
 *       200:
 *         description: Rating created successfully
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
 *       400:
 *         description: Invalid request or order already rated
 *       403:
 *         description: Access denied - order doesn't belong to user
 *       404:
 *         description: Order not found
 */
router.post("/", authMiddleware, createRating);

/**
 * @swagger
 * /rating/delivery-agent/{deliveryAgentId}:
 *   get:
 *     summary: Get delivery agent ratings
 *     description: Get ratings for a specific delivery agent
 *     tags:
 *       - Rating
 *     parameters:
 *       - in: path
 *         name: deliveryAgentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Delivery agent ID
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: minRating
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *         description: Minimum rating filter
 *     responses:
 *       200:
 *         description: Ratings retrieved successfully
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
 *                     ratings:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *                     statistics:
 *                       type: object
 *                       properties:
 *                         averageRating:
 *                           type: number
 *                         totalReviews:
 *                           type: number
 *                         ratingDistribution:
 *                           type: object
 *                         averageBreakdown:
 *                           type: object
 *       404:
 *         description: Delivery agent not found
 */
router.get("/delivery-agent/:deliveryAgentId", getDeliveryAgentRatings);

/**
 * @swagger
 * /rating/my-ratings:
 *   get:
 *     summary: Get my ratings
 *     description: Get ratings given by the authenticated user
 *     tags:
 *       - Rating
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Items per page
 *     responses:
 *       200:
 *         description: User's ratings retrieved successfully
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
 *                     ratings:
 *                       type: array
 *                       items:
 *                         type: object
 *                     pagination:
 *                       type: object
 *       401:
 *         description: Unauthorized
 */
router.get("/my-ratings", authMiddleware, getMyRatings);

/**
 * @swagger
 * /rating/{ratingId}:
 *   put:
 *     summary: Update rating
 *     description: Update an existing rating (within 24 hours)
 *     tags:
 *       - Rating
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ratingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Rating ID to update
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               rating:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 5
 *                 description: Updated overall rating
 *               breakdown:
 *                 type: object
 *                 properties:
 *                   punctuality:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   communication:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   handling:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *                   professionalism:
 *                     type: number
 *                     minimum: 1
 *                     maximum: 5
 *               review:
 *                 type: string
 *                 maxLength: 500
 *                 description: Updated review text
 *     responses:
 *       200:
 *         description: Rating updated successfully
 *       400:
 *         description: Invalid request or rating too old to update
 *       403:
 *         description: Access denied - can only update own ratings
 *       404:
 *         description: Rating not found
 */
router.put("/:ratingId", authMiddleware, updateRating);

/**
 * @swagger
 * /rating/{ratingId}:
 *   delete:
 *     summary: Delete rating
 *     description: Delete a rating
 *     tags:
 *       - Rating
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: ratingId
 *         required: true
 *         schema:
 *           type: string
 *         description: Rating ID to delete
 *     responses:
 *       200:
 *         description: Rating deleted successfully
 *       403:
 *         description: Access denied - can only delete own ratings
 *       404:
 *         description: Rating not found
 */
router.delete("/:ratingId", authMiddleware, deleteRating);

/**
 * @swagger
 * /rating/report:
 *   post:
 *     summary: Report inappropriate rating
 *     description: Report an inappropriate rating
 *     tags:
 *       - Rating
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ratingId
 *               - reason
 *             properties:
 *               ratingId:
 *                 type: string
 *                 description: Rating ID to report
 *               reason:
 *                 type: string
 *                 description: Reason for reporting
 *     responses:
 *       200:
 *         description: Rating reported successfully
 *       400:
 *         description: Invalid request
 *       404:
 *         description: Rating not found
 */
router.post("/report", authMiddleware, reportRating);

module.exports = router;
