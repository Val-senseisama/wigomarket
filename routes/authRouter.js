const express = require("express");
const {
  createUser,
  createBuyer,
  createSeller,
  createDeliveryAgent,
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
  forgotPasswordToken,
  getUserCart,
  updateCart,
  getUsersByStatus,
  getCurrentUser,
  changeActiveRole,
  googleAuth,
  resetPassword,
  verifyResetToken,
} = require("../controllers/user");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();
/**
 * @swagger
 * /api/user/register:
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

// ==================== ROLE-SPECIFIC SIGNUP ROUTES ====================

/**
 * @swagger
 * /api/user/register/buyer:
 *   post:
 *     summary: Register a new buyer account
 *     description: >
 *       Creates a buyer account and sends two emails in the background: a welcome
 *       email and an email containing the OTP verification code. The account status
 *       is `pending` until the code is submitted to POST /api/user/verify, which
 *       activates the account and returns auth tokens so the user is immediately
 *       logged in.
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
 *               - mobile
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address — must be unique across all accounts
 *                 example: "buyer@example.com"
 *               mobile:
 *                 type: string
 *                 description: Mobile number — must be unique across all accounts
 *                 example: "+2348012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 description: Account password (min 6 characters)
 *                 example: "password123"
 *               fullName:
 *                 type: string
 *                 description: Full name (optional)
 *                 example: "John Doe"
 *               residentialAddress:
 *                 type: string
 *                 description: Residential address (optional)
 *                 example: "123 Main Street, Lagos"
 *               city:
 *                 type: string
 *                 description: City (optional)
 *                 example: "Lagos"
 *               state:
 *                 type: string
 *                 description: State (optional)
 *                 example: "Lagos State"
 *     responses:
 *       201:
 *         description: Account created — verification email sent
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
 *                   example: "Account created successfully. Please check your email for your verification code."
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                           description: The new user's ID — store this to reference the account before tokens are issued
 *                           example: "665f1a2b3c4d5e6f7a8b9c0d"
 *                         email:
 *                           type: string
 *                           example: "buyer@example.com"
 *                         mobile:
 *                           type: string
 *                           example: "+2348012345678"
 *                         fullName:
 *                           type: string
 *                           example: "John Doe"
 *                         role:
 *                           type: array
 *                           description: Roles assigned to this account
 *                           items:
 *                             type: string
 *                           example: ["buyer"]
 *                         activeRole:
 *                           type: string
 *                           description: The role currently in use
 *                           example: "buyer"
 *                         status:
 *                           type: string
 *                           description: >
 *                             `pending` — account is awaiting email verification.
 *                             Changes to `active` after POST /api/user/verify succeeds.
 *                           example: "pending"
 *       400:
 *         description: Validation error or duplicate email / mobile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 msg:
 *                   type: string
 *                   example: "User already exists"
 */
router.post("/register/buyer", createBuyer);

/**
 * @swagger
 * /api/user/register/seller:
 *   post:
 *     summary: Register a new seller account
 *     description: >
 *       Creates a seller account and sends two emails in the background: a welcome
 *       email and an email containing the OTP verification code. The account status
 *       is `pending` until the code is submitted to POST /api/user/verify, which
 *       activates the account and returns auth tokens. Sellers typically continue
 *       onboarding after verification (e.g. store creation, wallet setup) using
 *       the token received from the verify endpoint.
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
 *               - mobile
 *               - password
 *               - gender
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address — must be unique across all accounts
 *                 example: "seller@example.com"
 *               mobile:
 *                 type: string
 *                 description: Mobile number — must be unique across all accounts
 *                 example: "+2348012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 description: Account password (min 6 characters)
 *                 example: "password123"
 *               gender:
 *                 type: string
 *                 enum: [male, female, other]
 *                 description: Required for seller accounts
 *                 example: "female"
 *               fullName:
 *                 type: string
 *                 description: Full name (optional)
 *                 example: "Jane Smith"
 *               residentialAddress:
 *                 type: string
 *                 description: Residential address (optional)
 *                 example: "456 Business Street, Lagos"
 *               city:
 *                 type: string
 *                 description: City (optional)
 *                 example: "Lagos"
 *               state:
 *                 type: string
 *                 description: State (optional)
 *                 example: "Lagos State"
 *     responses:
 *       201:
 *         description: Account created — verification email sent
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
 *                   example: "Seller account created successfully. Please check your email for your verification code."
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                           description: The new user's ID — store this to reference the account before tokens are issued
 *                           example: "665f1a2b3c4d5e6f7a8b9c0d"
 *                         email:
 *                           type: string
 *                           example: "seller@example.com"
 *                         mobile:
 *                           type: string
 *                           example: "+2348012345678"
 *                         fullName:
 *                           type: string
 *                           example: "Jane Smith"
 *                         gender:
 *                           type: string
 *                           example: "female"
 *                         role:
 *                           type: array
 *                           description: Roles assigned to this account
 *                           items:
 *                             type: string
 *                           example: ["seller"]
 *                         activeRole:
 *                           type: string
 *                           description: The role currently in use
 *                           example: "seller"
 *                         status:
 *                           type: string
 *                           description: >
 *                             `pending` — account is awaiting email verification.
 *                             Changes to `active` after POST /api/user/verify succeeds.
 *                           example: "pending"
 *                     verificationCode:
 *                       type: string
 *                       description: "Returned for testing only — not present in production builds"
 *                       example: "A1B2C3"
 *       400:
 *         description: Validation error, missing required field, or duplicate email / mobile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 msg:
 *                   type: string
 *                   example: "User Already Exists"
 */
router.post("/register/seller", createSeller);

/**
 * @swagger
 * /api/user/register/delivery:
 *   post:
 *     summary: Register a new delivery agent account
 *     description: >
 *       Creates a delivery agent (dispatch rider) account and sends two emails in
 *       the background: a welcome email and an email containing the OTP verification
 *       code. The account status is `pending` until the code is submitted to
 *       POST /api/user/verify, which activates the account and returns auth tokens.
 *       Riders typically continue onboarding after verification (e.g. wallet setup,
 *       dispatch profile completion) using the token received from the verify endpoint.
 *       Note: `gender`, `nextOfKin`, and `modeOfTransport` are all required for
 *       delivery agents.
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
 *               - mobile
 *               - password
 *               - gender
 *               - nextOfKin
 *               - modeOfTransport
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address — must be unique across all accounts
 *                 example: "rider@example.com"
 *               mobile:
 *                 type: string
 *                 description: Mobile number — must be unique across all accounts
 *                 example: "+2348012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 description: Account password (min 6 characters)
 *                 example: "password123"
 *               gender:
 *                 type: string
 *                 enum: [male, female, other]
 *                 description: Required for delivery agent accounts
 *                 example: "male"
 *               fullName:
 *                 type: string
 *                 description: Full name (optional)
 *                 example: "Mike Johnson"
 *               residentialAddress:
 *                 type: string
 *                 description: Residential address (optional)
 *                 example: "789 Delivery Street, Lagos"
 *               city:
 *                 type: string
 *                 description: City (optional)
 *                 example: "Lagos"
 *               state:
 *                 type: string
 *                 description: State (optional)
 *                 example: "Lagos State"
 *               nextOfKin:
 *                 type: object
 *                 description: Emergency contact — required for delivery agents
 *                 required:
 *                   - name
 *                   - mobile
 *                 properties:
 *                   name:
 *                     type: string
 *                     description: Next of kin's full name
 *                     example: "Sarah Johnson"
 *                   mobile:
 *                     type: string
 *                     description: Next of kin's mobile number
 *                     example: "+2348098765432"
 *               modeOfTransport:
 *                 type: string
 *                 enum: [bike, motorcycle, car, van, truck, bicycle, feet, bus]
 *                 description: The delivery agent's primary mode of transport
 *                 example: "motorcycle"
 *     responses:
 *       201:
 *         description: Account created — verification email sent
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
 *                   example: "Delivery agent account created successfully. Please check your email for your verification code."
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                           description: The new user's ID — store this to reference the account before tokens are issued
 *                           example: "665f1a2b3c4d5e6f7a8b9c0d"
 *                         email:
 *                           type: string
 *                           example: "rider@example.com"
 *                         mobile:
 *                           type: string
 *                           example: "+2348012345678"
 *                         fullName:
 *                           type: string
 *                           example: "Mike Johnson"
 *                         gender:
 *                           type: string
 *                           example: "male"
 *                         role:
 *                           type: array
 *                           description: Roles assigned to this account
 *                           items:
 *                             type: string
 *                           example: ["dispatch"]
 *                         activeRole:
 *                           type: string
 *                           description: The role currently in use
 *                           example: "dispatch"
 *                         status:
 *                           type: string
 *                           description: >
 *                             `pending` — account is awaiting email verification.
 *                             Changes to `active` after POST /api/user/verify succeeds.
 *                           example: "pending"
 *                         nextOfKin:
 *                           type: object
 *                           properties:
 *                             name:
 *                               type: string
 *                               example: "Sarah Johnson"
 *                             mobile:
 *                               type: string
 *                               example: "+2348098765432"
 *                         modeOfTransport:
 *                           type: string
 *                           example: "motorcycle"
 *                     verificationCode:
 *                       type: string
 *                       description: "Returned for testing only — not present in production builds"
 *                       example: "A1B2C3"
 *       400:
 *         description: Validation error, missing required field, or duplicate email / mobile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 msg:
 *                   type: string
 *                   example: "User Already Exists"
 */
router.post("/register/delivery", createDeliveryAgent);

/**
 * @swagger
 * /api/user/forgot-password-token:
 *   post:
 *     summary: "Step 1 — Request password reset: sends a 6-digit OTP to the email"
 *     description: >
 *       Generates a 6-digit numeric OTP, stores a hashed copy (15-minute TTL),
 *       and emails it to the user. Always returns 200 with a generic message so that
 *       the existence of an account cannot be inferred from the response.
 *       Proceed to POST /api/user/verify-reset-token once the user has the code.
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
 *                 format: email
 *                 description: The email address registered to the account
 *                 example: "user@example.com"
 *     responses:
 *       200:
 *         description: Reset code sent (or silently dropped if email not registered)
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
 *                   example: "If an account with that email exists, a reset code has been sent."
 *                 expiresIn:
 *                   type: string
 *                   example: "15 minutes"
 *       400:
 *         description: Invalid email format
 */
router.post("/forgot-password-token", forgotPasswordToken);
/**
 * @swagger
 * /api/user/verify-reset-token:
 *   post:
 *     summary: "Step 2 — Verify the 6-digit OTP from the email"
 *     description: >
 *       Validates the 6-digit code that was emailed in step 1. On success:
 *       the OTP is consumed (cannot be replayed), and a one-time `resetSession`
 *       token is returned. Store this value — it is required as proof-of-possession
 *       in step 3 (PUT /api/user/reset-password). Only the client that calls this
 *       endpoint receives the `resetSession` nonce, preventing any other party from
 *       hijacking the reset even if they know the email address.
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
 *                 format: email
 *                 example: "user@example.com"
 *               code:
 *                 type: string
 *                 description: The 6-digit numeric OTP from the email
 *                 example: "482910"
 *     responses:
 *       200:
 *         description: Code verified — `resetSession` token returned for step 3
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
 *                   example: "Code verified. You may now reset your password."
 *                 resetSession:
 *                   type: string
 *                   description: >
 *                     One-time proof-of-possession token. Pass this to
 *                     PUT /api/user/reset-password as `resetSession`.
 *                     Expires with the 15-minute reset window.
 *                   example: "a3f1c8e2b9d4..."
 *       400:
 *         description: Code is invalid, wrong format, or expired
 */
router.post("/verify-reset-token", verifyResetToken);
/**
 * @swagger
 * /api/user/reset-password:
 *   put:
 *     summary: "Step 3 — Set new password"
 *     description: >
 *       Sets the user's new password. Requires the `resetSession` token returned
 *       by step 2 (POST /api/user/verify-reset-token) as proof that the caller
 *       is the same client that verified the OTP. The session is consumed atomically
 *       — concurrent requests cannot both succeed. The user must log in again after
 *       a successful reset.
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
 *               - resetSession
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The same email used in steps 1 and 2
 *                 example: "user@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 description: The new password (min 6 characters)
 *                 example: "newSecurePassword123"
 *               resetSession:
 *                 type: string
 *                 description: >
 *                   The one-time token returned by step 2. Proves that this
 *                   client completed the OTP verification step.
 *                 example: "a3f1c8e2b9d4..."
 *     responses:
 *       200:
 *         description: Password reset successfully
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
 *                   example: "Password reset successfully. Please log in with your new password."
 *       400:
 *         description: Invalid or expired resetSession, or password too short
 *       404:
 *         description: User not found
 */
router.put("/reset-password", resetPassword);
/**
 * @swagger
 * /api/user/login:
 *   post:
 *     summary: Log in and receive auth tokens
 *     description: >
 *       Authenticates the user with email and password. Returns an access token
 *       (valid 1 day) and a refresh token (valid 3 days). The refresh token is
 *       also set as an HTTP-only cookie for web clients. Mobile clients should
 *       store the `refreshToken` from the response body securely (e.g. device
 *       keychain / secure storage) and use it to call POST /api/user/refresh
 *       when the access token expires.
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
 *                 format: email
 *                 description: The email address used during registration
 *                 example: "user@example.com"
 *               password:
 *                 type: string
 *                 format: password
 *                 description: The user's password
 *                 example: "password123"
 *     responses:
 *       200:
 *         description: Login successful — full auth payload returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                   description: The user's unique ID
 *                   example: "665f1a2b3c4d5e6f7a8b9c0d"
 *                 status:
 *                   type: string
 *                   description: Account status
 *                   example: "active"
 *                 role:
 *                   type: array
 *                   description: All roles assigned to this user
 *                   items:
 *                     type: string
 *                   example: ["buyer"]
 *                 activeRole:
 *                   type: string
 *                   description: The role currently in use (relevant for multi-role accounts)
 *                   example: "buyer"
 *                 token:
 *                   type: string
 *                   description: "JWT access token — include as `Authorization: Bearer <token>` on authenticated requests"
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 refreshToken:
 *                   type: string
 *                   description: >
 *                     Refresh token used to obtain a new access token without re-logging in.
 *                     Valid for 3 days. Also set as an HTTP-only cookie for web clients.
 *                     Mobile clients must store this securely and send it in the body of
 *                     POST /api/user/refresh.
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 tokenExpiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: >
 *                     ISO 8601 timestamp of when the access token expires.
 *                     Use this on the client to schedule silent token refresh before
 *                     the token expires (recommended: refresh ~60 seconds before expiry).
 *                   example: "2026-05-28T12:00:00.000Z"
 *       400:
 *         description: Invalid email or password format
 *       401:
 *         description: Incorrect credentials
 *       403:
 *         description: Account is blocked
 */
router.post("/login", loginUser);
/**
 * @swagger
 * /api/user/all-users:
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
 * /api/user/status-users:
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
 * /api/user/refresh:
 *   post:
 *     summary: Get a new access token using a refresh token
 *     description: >
 *       Issues a new access token given a valid refresh token.
 *       Web clients send the token via HTTP-only cookie (automatic).
 *       Mobile clients send it in the request body as `refreshToken`.
 *     tags:
 *       - Auth
 *     requestBody:
 *       description: Required for mobile clients (web uses the cookie automatically)
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: The refresh token received at login or email verification
 *     responses:
 *       200:
 *         description: New access token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 token:
 *                   type: string
 *                   description: New JWT access token (valid for 1 day)
 *                 tokenExpiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: ISO timestamp of when the new access token expires
 *                   example: "2026-05-28T12:00:00.000Z"
 *       401:
 *         description: No refresh token provided
 *       403:
 *         description: Invalid, expired, or revoked refresh token
 */
router.post("/refresh", handleRefreshToken);
/**
 * @swagger
 * /api/user/logout:
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
router.get("/logout", logoutUser);
/**
 * @swagger
 * /api/user/get-cart:
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
 * /api/user/:id:
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
/**
 * @swagger
 * /api/user/me:
 *   get:
 *     summary: Get current authenticated user's information
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                 roles:
 *                   type: array
 *                 activeRole:
 *                   type: string
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 */
router.get("/me", authMiddleware, getCurrentUser);

router.get("/:id", authMiddleware, isAdmin, getAUser);
/**
 * @swagger
 * /api/user/edit-user:
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
 * @route DELETE /delete/:id
 * @description Delete user by ID
 * @access Private, Admin only
 * @param {string} req.params.id - User ID to delete (required)
 * @returns {Object} - Deletion result
 * @throws {Error} - Throws error if deletion fails
 */
/**
 * @swagger
 * /api/user/delete/:id:
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
router.delete("/delete/:id", authMiddleware, isAdmin, deleteAUser);
/**
 * @swagger
 * /api/user/block-user/:id:
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
 * /api/user/unblock-user/:id:
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
 * /api/user/update-cart:
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
 * /api/user/add-cart:
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
 * /api/user/empty-cart:
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
 * /api/user/verify:
 *   post:
 *     summary: Verify email OTP — activates account and returns auth tokens
 *     description: >
 *       Submits the verification code that was emailed after registration.
 *       On success the account status changes from `pending` to `active` and a
 *       full auth payload is returned — the user is immediately logged in with
 *       no separate login call required. This is the correct place to obtain
 *       the first access token, including for sellers and riders who need to
 *       authenticate during the post-registration onboarding steps (e.g. wallet
 *       creation). The refresh token is also set as an HTTP-only cookie for
 *       web clients.
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
 *                 format: email
 *                 description: The same email used during registration
 *                 example: "user@example.com"
 *               code:
 *                 type: string
 *                 description: The verification code sent to the email inbox
 *                 example: "A1B2C3"
 *     responses:
 *       200:
 *         description: Email verified — account is active and user is logged in
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 msg:
 *                   type: string
 *                   example: "Email verified successfully"
 *                 _id:
 *                   type: string
 *                   description: The user's unique ID
 *                   example: "665f1a2b3c4d5e6f7a8b9c0d"
 *                 role:
 *                   type: array
 *                   description: All roles assigned to this user
 *                   items:
 *                     type: string
 *                   example: ["seller"]
 *                 activeRole:
 *                   type: string
 *                   description: The role currently in use
 *                   example: "seller"
 *                 token:
 *                   type: string
 *                   description: "JWT access token — include as `Authorization: Bearer <token>` on authenticated requests. Valid for 1 day."
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 refreshToken:
 *                   type: string
 *                   description: >
 *                     Refresh token used to silently renew the access token. Valid for 3 days.
 *                     Also set as an HTTP-only cookie for web clients. Mobile clients must store
 *                     this securely and send it in the body of POST /api/user/refresh.
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 tokenExpiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: >
 *                     ISO 8601 timestamp of when the access token expires.
 *                     Use this to schedule silent refresh on the client side
 *                     (recommended: call POST /api/user/refresh ~60 seconds before expiry).
 *                   example: "2026-05-28T12:00:00.000Z"
 *       400:
 *         description: Code is invalid, does not match, or has already been used
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 msg:
 *                   type: string
 *                   example: "Invalid code"
 *       404:
 *         description: No pending account found for this email
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 msg:
 *                   type: string
 *                   example: "User not found"
 */
router.post("/verify", verifyOtp);

/**
 * @swagger
 * /api/user/me:
 *   get:
 *     summary: Get current authenticated user's information
 *     description: Get current authenticated user's information with role-based data
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user information with roles and permissions
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
 *                     user:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         fullName:
 *                           type: string
 *                         email:
 *                           type: string
 *                         mobile:
 *                           type: string
 *                         role:
 *                           type: array
 *                           items:
 *                             type: string
 *                         residentialAddress:
 *                           type: string
 *                         city:
 *                           type: string
 *                         state:
 *                           type: string
 *                         image:
 *                           type: string
 *                         status:
 *                           type: string
 *                         balance:
 *                           type: number
 *                         store:
 *                           type: object
 *                           description: Store information (if user is a seller)
 *                         dispatchProfile:
 *                           type: object
 *                           description: Dispatch profile (if user is dispatch)
 *                     roles:
 *                       type: array
 *                       items:
 *                         type: string
 *                     activeRole:
 *                       type: string
 *                       description: Currently active role
 *                       example: "buyer"
 *                     permissions:
 *                       type: object
 *                       properties:
 *                         canSell:
 *                           type: boolean
 *                         canDispatch:
 *                           type: boolean
 *                         isAdmin:
 *                           type: boolean
 *                         isBuyer:
 *                           type: boolean
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 */
/**
 * @swagger
 * /api/user/change-role:
 *   put:
 *     summary: Change user's active role
 *     description: Change the user's currently active role to one of their assigned roles
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
 *               - role
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [seller, buyer, dispatch, admin]
 *                 description: New active role to set
 *                 example: "seller"
 *     responses:
 *       200:
 *         description: Active role updated successfully
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
 *                   example: "Active role updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         _id:
 *                           type: string
 *                         fullName:
 *                           type: string
 *                         email:
 *                           type: string
 *                         mobile:
 *                           type: string
 *                         role:
 *                           type: array
 *                           items:
 *                             type: string
 *                         activeRole:
 *                           type: string
 *                     activeRole:
 *                       type: string
 *                     roles:
 *                       type: array
 *                       items:
 *                         type: string
 *       400:
 *         description: Invalid role or user doesn't have permission for that role
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
 *                   example: "You don't have permission to switch to this role"
 *       401:
 *         description: Unauthorized
 */
router.put("/change-role", authMiddleware, changeActiveRole);

/**
 * @swagger
 * /api/user/google-auth:
 *   post:
 *     summary: Authenticate with Google using Firebase ID token
 *     description: Authenticate user with Google using Firebase ID token verification
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Firebase ID token from Google authentication
 *                 example: "eyJhbGciOiJSUzI1NiIsImtpZCI6IjE2NzEwMjQ4NzQ..."
 *     responses:
 *       200:
 *         description: Google authentication successful
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
 *                   example: "Google authentication successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     _id:
 *                       type: string
 *                       example: "64f8a1b2c3d4e5f6a7b8c9d0"
 *                     fullName:
 *                       type: string
 *                       example: "John Doe"
 *                     email:
 *                       type: string
 *                       example: "john.doe@gmail.com"
 *                     image:
 *                       type: string
 *                       example: "https://lh3.googleusercontent.com/a/..."
 *                     role:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["buyer"]
 *                     activeRole:
 *                       type: string
 *                       example: "buyer"
 *                     status:
 *                       type: string
 *                       example: "active"
 *                     token:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                     isGoogleAuth:
 *                       type: boolean
 *                       example: true
 *       400:
 *         description: Missing ID token
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
 *                   example: "ID token is required"
 *       401:
 *         description: Invalid Google ID token
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
 *                   example: "Invalid Google ID token"
 *       403:
 *         description: User account is blocked
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
 *                   example: "User account is blocked"
 *       500:
 *         description: Google authentication failed
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
 *                   example: "Google authentication failed"
 *                 error:
 *                   type: string
 *                   example: "Error details"
 */
router.post("/google-auth", googleAuth);

module.exports = router;
