const express = require("express");
const {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  confirmDelivery,
} = require("../controllers/order");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Orders
 *   description: Order management
 */

/**
 * @swagger
 * /api/order/create:
 *   post:
 *     summary: Create a new order
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - paymentMethod
 *               - deliveryMethod
 *               - deliveryAddress
 *             properties:
 *               paymentMethod:
 *                 type: string
 *               deliveryMethod:
 *                 type: string
 *               deliveryAddress:
 *                 type: object
 *               deliveryNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Order created successfully
 *       400:
 *         description: Bad request
 */
router.post("/create", authMiddleware, createOrder);

/**
 * @swagger
 * /api/order/my-orders:
 *   get:
 *     summary: Get logged-in user's orders
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of orders
 */
router.get("/my-orders", authMiddleware, getOrders);

/**
 * @swagger
 * /api/order/{id}:
 *   get:
 *     summary: Get order by ID
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: Order ID
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found
 */
router.get("/:id", authMiddleware, getOrderById);

/**
 * @swagger
 * /api/order/{id}/status:
 *   put:
 *     summary: Update order status (Admin/Internal use)
 *     tags: [Orders]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Status updated
 */
router.put("/:id/status", authMiddleware, isAdmin, updateOrderStatus);

/**
 * @swagger
 * /api/order/confirm-delivery:
 *   post:
 *     summary: Customer confirms delivery receipt
 *     description: |
 *       Called by the customer when they physically receive their order.
 *       If the delivery agent has already confirmed on their end, the agent's
 *       earnings are credited immediately and both parties are notified by email (sent via background queue).
 *       If the agent has not yet confirmed, the customer's confirmation is recorded
 *       and earnings will be credited once the agent confirms.
 *     tags: [Orders]
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
 *                 description: ID of the order being confirmed
 *     responses:
 *       200:
 *         description: Confirmation recorded
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
 *                     credited:
 *                       type: boolean
 *                     amount:
 *                       type: number
 *                     walletBalance:
 *                       type: number
 *                     reason:
 *                       type: string
 *       400:
 *         description: orderId missing, order already delivered, or order does not belong to user
 *       401:
 *         description: Unauthorized
 */
router.post("/confirm-delivery", authMiddleware, confirmDelivery);

module.exports = router;
