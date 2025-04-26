const express = require("express");
const {
  search,
  getAStore,
  getAllStores,
  createStore,
  getMyStore,
  updateBankDetails,
} = require("../controllers/storeController");
const { authMiddleware, isSeller } = require("../middleware/authMiddleware");

const router = express.Router();
/**
 * @swagger
 * /create:
 *   post:
 *     summary: Create a new store for a user
 *     description: Create a new store for a user
 *     tags:
 *       - Stores
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - address
 *               - storeMobile
 *               - storeEmail
 *               - storeImage
 *             properties:
 *               name:
 *                 type: string
 *               address:
 *                 type: string
 *               storeMobile:
 *                 type: string
 *               storeEmail:
 *                 type: string
 *               storeImage:
 *                 type: string
 *     responses:
 *       200:
 *         description: Created store information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
 *                   type: string
 *                 mobile:
 *                   type: string
 *                 email:
*                   type: string
*                 owner:
*                   type: string
*                 address:
*                   type: string
*       400:
*         description: Validation fails, store already exists, or creation fails
*/
router.post("/create", authMiddleware, createStore);
/**
 * @swagger
 * /my-store:
 *   get:
 *     summary: Get the current user's store
 *     description: Get the current user's store
 *     tags:
 *       - Stores
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's store information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
*               properties:
*                 _id:
*                   type: string
*                 name:
*                   type: string
*                 mobile:
*                   type: string
*                 email:
*                   type: string
*                 owner:
*                   type: string
*                 address:
*                   type: string
*       400:
*         description: Store not found or retrieval fails
*/
router.get("/my-store", authMiddleware, isSeller, getMyStore);
/**
 * @swagger
 * /bank-details:
 *   post:
 *     summary: Update store's bank details and create subaccount
 *     description: Update store's bank details and create subaccount
 *     tags:
 *       - Stores
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
*             type: object
*             required:
*               - bankName
*               - accountNumber
*               - accountName
*               - bankCode
*             properties:
*               bankName:
*                 type: string
*               accountNumber:
*                 type: string
*               accountName:
*                 type: string
*               bankCode:
*                 type: string
*     responses:
*       200:
*         description: Updated store information with bank details
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 name:
*                   type: string
*                 mobile:
*                   type: string
*                 email:
*                   type: string
*                 owner:
*                   type: string
*                 address:
*                   type: string
*                 bankDetails:
*                   type: object
*                   properties:
*                     accountName:
*                       type: string
*                     accountNumber:
*                       type: string
*                     bankCode:
*                       type: string
*                     bankName:
*                       type: string
*                 subAccountDetails:
*                   type: object
*       400:
*         description: Validation fails, store not found, or bank details update fails
*/
router.post("/bank-details", authMiddleware, isSeller, updateBankDetails);
/**
 * @swagger
 * /all:
 *   get:
 *     summary: Get all stores with selected fields
 *     description: Get all stores with selected fields
 *     tags:
 *       - Stores
 *     responses:
 *       200:
 *         description: Array of store objects with selected fields
 *         content:
 *           application/json:
 *             schema:
 *               type: array
*               items:
*                 type: object
*                 properties:
*                   _id:
*                     type: string
*                   name:
*                     type: string
*                   image:
*                     type: string
*                   email:
*                     type: string
*                   mobile:
*                     type: string
*                   address:
*                     type: string
*       400:
*         description: Retrieval fails
*/
router.get("/all", getAllStores);
/**
 * @swagger
 * /:id:
 *   get:
 *     summary: Get a single store by ID
 *     description: Get a single store by ID
 *     tags:
 *       - Stores
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Store ID
 *     responses:
 *       200:
 *         description: Store information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
*               properties:
*                 _id:
*                   type: string
*                 name:
*                   type: string
*                 mobile:
*                   type: string
*                 email:
*                   type: string
*                 owner:
*                   type: string
*                 address:
*                   type: string
*       400:
*         description: Store not found or retrieval fails
*/
router.get("/:id", getAStore);
/**
 * @swagger
 * /:
 *   get:
 *     summary: Search for products and stores
 *     description: Search for products and stores
 *     tags:
 *       - Stores
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
*         description: Search keyword
*     responses:
*       200:
*         description: Search results containing products and stores
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 products:
*                   type: array
*                   items:
*                     type: object
*                     properties:
*                       title:
*                         type: string
*                       quantity:
*                         type: number
*                       listedPrice:
*                         type: number
*                       image:
*                         type: string
*                       description:
*                         type: string
*                       brand:
*                         type: string
*                       storeDetails:
*                         type: object
*                         properties:
*                           name:
*                             type: string
*                           address:
*                             type: string
*                           mobile:
*                             type: string
*                           image:
*                             type: string
*                 stores:
*                   type: array
*                   items:
*                     type: object
*                     properties:
*                       _id:
*                         type: string
*                       name:
*                         type: string
*                       image:
*                         type: string
*                       email:
*                         type: string
*                       mobile:
*                         type: string
*                       address:
*                         type: string
*       400:
*         description: Search fails
*/
router.get("/", search);

module.exports = router;
