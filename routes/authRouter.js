const express = require("express");
const {
  createUser,
  loginUser,
  getAllUsers,
  getAUser,
  deleteAUser,
  updateAUser,
  blockUser,
  unblockUser,
  handleRefreshToken,
  logoutUser,
  addToCart2,
  emptyCart,
  verifyOtp,
  resetPassword,
  forgotPasswordToken,
  getUserCart,
  updateCart,
  createOrder,
  getUsersByStatus,
} = require("../controllers/userController");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const { commissionHandler } = require("../controllers/paymentController");
const router = express.Router();
/**
 * @swagger
 * /register:
 *   post:
 *     summary: Register a new user account
 *     description: Register a new user account
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - firstname
 *               - lastname
 *               - mobile
 *               - password
 *               - role
 *             properties:
 *               email:
 *                 type: string
 *                 description: User's email address
 *               firstname:
 *                 type: string
 *                 description: User's first name
 *               lastname:
 *                 type: string
 *                 description: User's last name
 *               mobile:
 *                 type: string
 *                 description: User's mobile number
 *               password:
 *                 type: string
 *                 description: User's password
 *               role:
 *                 type: string
 *                 description: User's role
 *                 enum: [seller, buyer, dispatch, admin]
 *     responses:
 *       200:
 *         description: New user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 email:
 *                   type: string
 *                 firstname:
 *                   type: string
 *                 lastname:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 role:
 *                   type: string
 *       400:
 *         description: Validation error or user already exists
 */
router.post("/register", createUser);

/**
 * @swagger
 * /forgot-password-token:
 *   post:
 *     summary: Generate password reset token and send to user's email
 *     description: Generate password reset token and send to user's email
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 description: User's email address
 *     responses:
 *       200:
 *         description: Generated password reset token
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *       400:
 *         description: User not found or token creation fails
 */
router.post("/forgot-password-token", forgotPasswordToken);
/**
 * @swagger
 * /reset-password:
 *   put:
 *     summary: Reset user's password using reset token
 *     description: Reset user's password using reset token
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *               - token
 *               - email
 *             properties:
 *               password:
 *                 type: string
 *                 description: New password to set
 *               token:
 *                 type: string
 *                 description: Reset token
 *               email:
 *                 type: string
 *                 description: User's email address
 *     responses:
 *       200:
 *         description: Updated user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 email:
 *                   type: string
 *                 password:
 *                   type: string
 *       400:
 *         description: Invalid token or user not found
 */
router.put("/reset-password", resetPassword);
/**
 * @swagger
 * /login:
 *   post:
 *     summary: Authenticate user and generate tokens
 *     description: Authenticate user and generate tokens
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 description: User's email address
 *               password:
 *                 type: string
 *                 description: User's password
 *     responses:
 *       200:
 *         description: User data and authentication tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 status:
 *                   type: string
 *                 role:
 *                   type: string
 *                 token:
 *                   type: string
 *       400:
 *         description: Invalid credentials
 */
router.post("/login", loginUser);
/**
 * @swagger
 * /all-users:
 *   get:
 *     summary: Get all active users (excluding pending users)
 *     description: Get all active users (excluding pending users)
 *     tags:
 *       - Users
 *     responses:
 *       200:
 *         description: Array of user objects with selected fields
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   image:
 *                     type: string
 *                   firstname:
 *                     type: string
 *                   lastname:
 *                     type: string
 *                   role:
 *                     type: string
 *                   mobile:
 *                     type: string
 *                   nickname:
 *                     type: string
 *       400:
 *         description: Database operation fails
 */
router.get("/all-users", getAllUsers);
/**
 * @swagger
 * /status-users:
 *   get:
 *     summary: Get users filtered by status
 *     description: Get users filtered by status
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
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
 *                 description: User status to filter by
 *                 enum: [active, pending, blocked]
 *     responses:
 *       200:
 *         description: Array of users matching the status
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                   image:
 *                     type: string
 *                   firstname:
 *                     type: string
 *                   lastname:
 *                     type: string
 *                   role:
 *                     type: string
 *                   mobile:
 *                     type: string
 *                   nickname:
 *                     type: string
 *       400:
 *         description: Invalid status value
 */
router.get("/status-users", authMiddleware, isAdmin, getUsersByStatus);
/**
 * @swagger
 * /refresh:
 *   get:
 *     summary: Get new access token using refresh token
 *     description: Get new access token using refresh token
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: New access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       400:
 *         description: Invalid refresh token
 */
router.get("/refresh", handleRefreshToken);
/**
 * @swagger
 * /logout:
 *   get:
 *     summary: Logout user by clearing refresh token cookie and updating user's refresh token
 *     description: Logout user by clearing refresh token cookie and updating user's refresh token
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Successful logout
 *       400:
 *         description: Invalid refresh token
 */
router.get("logout", logoutUser);
/**
 * @swagger
 * /get-cart:
 *   get:
 *     summary: Get user's cart with populated product details
 *     description: Get user's cart with populated product details
 *     tags:
 *       - Cart
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's cart with populated product details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 products:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           listedPrice:
 *                             type: number
 *                           store:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                               bankDetails:
 *                                 type: object
 *                               address:
 *                                 type: object
 *                               owner:
 *                                 type: object
 *                                 properties:
 *                                   mobile:
 *                                     type: string
 *                                   email:
 *                                     type: string
 *                       count:
 *                         type: number
 *                       price:
 *                         type: number
 *                 cartTotal:
 *                   type: number
 *       400:
 *         description: Cart retrieval fails
 */
router.get("/get-cart", authMiddleware, getUserCart);
/**
 * @swagger
 * /:id:
 *   get:
 *     summary: Get user details by ID
 *     description: Get user details by ID
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to retrieve
 *     responses:
 *       200:
 *         description: User information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 firstname:
 *                   type: string
 *                 lastname:
 *                   type: string
 *                 email:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 role:
 *                   type: string
 *                 image:
 *                   type: string
 *                 nickname:
 *                   type: string
 *       400:
 *         description: Invalid MongoDB ID or database operation fails
 */
router.get("/:id", authMiddleware, isAdmin, getAUser);
/**
 * @swagger
 * /edit-user:
 *   put:
 *     summary: Update user profile information
 *     description: Update user profile information
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstname:
 *                 type: string
 *                 description: User's first name
 *               lastname:
 *                 type: string
 *                 description: User's last name
 *               email:
 *                 type: string
 *                 description: User's email address
 *               mobile:
 *                 type: string
 *                 description: User's mobile number
 *               address:
 *                 type: string
 *                 description: User's address
 *               image:
 *                 type: string
 *                 description: User's profile image
 *               nickname:
 *                 type: string
 *                 description: User's nickname
 *     responses:
 *       200:
 *         description: Updated user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 firstname:
 *                   type: string
 *                 lastname:
 *                   type: string
 *                 email:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 address:
 *                   type: string
 *                 image:
 *                   type: string
 *                 nickname:
 *                   type: string
 *       400:
 *         description: Validation fails or mobile number already exists
 */
router.put("/edit-user", authMiddleware, updateAUser);
/**
 * @swagger
 * /pay:
 *   post:
 *     summary: Handle payment processing
 *     description: Handle payment processing
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment processing result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 result:
 *                   type: object
 *       400:
 *         description: Payment processing fails
 */
router.post("/pay", authMiddleware, commissionHandler);
/**
 * @route DELETE /delete/:id
 * @description Delete user by ID
 * @access Private, Admin only
 * @param {string} req.params.id - User ID to delete (required)
 * @returns {Object} - Payment processing result
 * @throws {Error} - Throws error if payment processing fails
 */
router.post("/pay", authMiddleware, commissionHandler);
/**
 * @swagger
 * /delete/:id:
 *   delete:
 *     summary: Delete user by ID
 *     description: Delete user by ID
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to delete
 *     responses:
 *       200:
 *         description: User deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Invalid MongoDB ID or database operation fails
 */
router.delete("/:id", deleteAUser);
/**
 * @swagger
 * /block-user/:id:
 *   put:
 *     summary: Block user by setting their isBlocked status to true
 *     description: Block user by setting their isBlocked status to true
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to block
 *     responses:
 *       200:
 *         description: Updated user information with blocked status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
*                 _id:
*                   type: string
*                 firstname:
*                   type: string
*                 lastname:
*                   type: string
*                 email:
*                   type: string
*                 mobile:
*                   type: string
*                 role:
*                   type: string
*                 isBlocked:
*                   type: boolean
*       400:
*         description: Invalid MongoDB ID or database operation fails
*/
router.put("/block-user/:id", authMiddleware, isAdmin, blockUser);
/**
 * @swagger
 * /unblock-user/:id:
 *   put:
 *     summary: Unblock user by setting their isBlocked status to false
 *     description: Unblock user by setting their isBlocked status to false
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to unblock
 *     responses:
 *       200:
 *         description: Updated user information with unblocked status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
*                 _id:
*                   type: string
*                 firstname:
*                   type: string
*                 lastname:
*                   type: string
*                 email:
*                   type: string
*                 mobile:
*                   type: string
*                 role:
*                   type: string
*                 isBlocked:
*                   type: boolean
*       400:
*         description: Invalid MongoDB ID or database operation fails
*/
router.put("/unblock-user/:id", authMiddleware, isAdmin, unblockUser);
/**
 * @swagger
 * /get-cart:
 *   get:
 *     summary: Get user's cart with populated product details
 *     description: Get user's cart with populated product details
 *     tags:
 *       - Cart
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's cart with populated product details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 products:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product:
 *                         type: object
 *                         properties:
 *                           _id:
*                             type: string
*                           title:
*                             type: string
*                           listedPrice:
*                             type: number
*                           store:
*                             type: object
*                             properties:
*                               _id:
*                                 type: string
*                               bankDetails:
*                                 type: object
*                               address:
*                                 type: object
*                               owner:
*                                 type: object
*                                 properties:
*                                   mobile:
*                                     type: string
*                                   email:
*                                     type: string
*                       count:
*                         type: number
*                       price:
*                         type: number
*                 cartTotal:
*                   type: number
*       400:
*         description: Cart retrieval fails
*/
router.get("/get-cart", authMiddleware, getUserCart);
/**
 * @swagger
 * /update-cart:
 *   put:
 *     summary: Update product quantity in user's cart
 *     description: Update product quantity in user's cart
 *     tags:
 *       - Cart
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - count
 *               - newCount
 *               - _id
 *               - product
 *             properties:
 *               count:
 *                 type: number
 *                 description: Current product count
 *               newCount:
 *                 type: number
 *                 description: New product count to set
 *               _id:
 *                 type: string
 *                 description: Product ID in cart
 *               product:
 *                 type: object
 *                 properties:
 *                   listedPrice:
 *                     type: number
 *                     description: Product price
 *     responses:
 *       200:
 *         description: Updated cart information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 products:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           listedPrice:
 *                             type: number
 *                           store:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                               bankDetails:
 *                                 type: object
 *                               address:
 *                                 type: object
 *                               owner:
*                                 type: object
*                                 properties:
*                                   mobile:
*                                     type: string
*                                   email:
*                                     type: string
*                       count:
*                         type: number
*                       price:
*                         type: number
*                 cartTotal:
*                   type: number
*       400:
*         description: Cart operation fails
*/
router.put("/update-cart", authMiddleware, updateCart);
/**
 * @swagger
 * /add-cart:
 *   post:
 *     summary: Add product to user's cart
 *     description: Add product to user's cart
 *     tags:
 *       - Cart
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - product
 *             properties:
 *               product:
 *                 type: object
 *                 description: Product details to add to cart
 *     responses:
 *       200:
 *         description: Updated cart information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 products:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       product:
 *                         type: object
 *                         properties:
 *                           _id:
 *                             type: string
 *                           title:
 *                             type: string
 *                           listedPrice:
 *                             type: number
 *                           store:
 *                             type: object
 *                             properties:
 *                               _id:
 *                                 type: string
 *                               bankDetails:
*                                 type: object
*                               address:
*                                 type: object
*                               owner:
*                                 type: object
*                                 properties:
*                                   mobile:
*                                     type: string
*                                   email:
*                                     type: string
*                       count:
*                         type: number
*                       price:
*                         type: number
*                 cartTotal:
*                   type: number
*       400:
*         description: Cart operation fails
*/
router.post("/add-cart", authMiddleware, addToCart2);
/**
 * @swagger
 * /empty-cart:
 *   post:
 *     summary: Empty user's cart by removing it from the database
 *     description: Empty user's cart by removing it from the database
 *     tags:
 *       - Cart
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Removed cart information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 products:
 *                   type: array
 *                   items:
*                     type: object
*                     properties:
*                       product:
*                         type: object
*                         properties:
*                           _id:
*                             type: string
*                           title:
*                             type: string
*                           listedPrice:
*                             type: number
*                           store:
*                             type: object
*                             properties:
*                               _id:
*                                 type: string
*                               bankDetails:
*                                 type: object
*                               address:
*                                 type: object
*                               owner:
*                                 type: object
*                                 properties:
*                                   mobile:
*                                     type: string
*                                   email:
*                                     type: string
*                       count:
*                         type: number
*                       price:
*                         type: number
*                 cartTotal:
*                   type: number
*       400:
*         description: Cart removal fails
*/
router.post("/empty-cart", authMiddleware, emptyCart);
/**
 * @swagger
 * /create-order:
 *   post:
 *     summary: Create a new order for the user
 *     description: Create a new order for the user
 *     tags:
 *       - Orders
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
*             type: object
*             required:
*               - paymentIntent
*               - deliveryMethod
*               - deliveryAddress
*             properties:
*               paymentIntent:
*                 type: string
*                 description: Payment intent ID
*               deliveryMethod:
*                 type: string
*                 description: Delivery method
*               deliveryAddress:
*                 type: object
*                 description: Delivery address details
*     responses:
*       200:
*         description: Created order details
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 products:
*                   type: array
*                   items:
*                     type: object
*                     properties:
*                       product:
*                         type: object
*                         properties:
*                           _id:
*                             type: string
*                           title:
*                             type: string
*                           listedPrice:
*                             type: number
*                           store:
*                             type: object
*                             properties:
*                               _id:
*                                 type: string
*                               bankDetails:
*                                 type: object
*                               address:
*                                 type: object
*                               owner:
*                                 type: object
*                                 properties:
*                                   mobile:
*                                     type: string
*                                   email:
*                                     type: string
*                       count:
*                         type: number
*                       price:
*                         type: number
*                 cartTotal:
*                   type: number
*       400:
*         description: Order creation fails
*/
router.post("/create-order", authMiddleware, createOrder);
/**
 * @swagger
 * /verify:
 *   post:
 *     summary: Verify user's email verification code
 *     description: Verify user's email verification code
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - code
 *             properties:
 *               email:
 *                 type: string
 *                 description: User's email address
 *               code:
 *                 type: string
 *                 description: Verification code
 *     responses:
 *       200:
 *         description: Verification status message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid email or code
 */
router.post("/verify", verifyOtp);

module.exports = router;
