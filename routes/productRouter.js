const express = require("express");
const {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  createProductCategory,
  updateProductCategory,
  getProductsByCategory,
  deleteProductCategory,
  getProductCategories,
} = require("../controllers/productController");
const { authMiddleware, isSeller, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();
/**
 * @swagger
 * /create-category:
 *   post:
 *     summary: Create a new product category
 *     description: Create a new product category
 *     tags:
 *       - Products
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
 *             properties:
 *               name:
 *                 type: string
 *                 description: Name of the category
 *     responses:
 *       200:
 *         description: Created category information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 _id:
 *                   type: string
 *                 name:
*                   type: string
*       400:
*         description: Category already exists or validation fails
*/
router.post("/create-category", authMiddleware, isAdmin, createProductCategory);
/**
 * @swagger
 * /update-category:
 *   put:
 *     summary: Update an existing product category
 *     description: Update an existing product category
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
*             required:
*               - id
*               - name
*             properties:
*               id:
*                 type: string
*                 description: Category ID
*               name:
*                 type: string
*                 description: New name for the category
*     responses:
*       200:
*         description: Updated category information
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 name:
*                   type: string
*       400:
*         description: Validation fails or category not found
*/
router.put("/update-category", authMiddleware, isAdmin, updateProductCategory)
/**
 * @swagger
 * /create-product:
 *   post:
 *     summary: Create a new product
 *     description: Create a new product
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
*             type: object
*             required:
*               - title
*               - price
*               - quantity
*               - category
*               - brand
*               - description
*             properties:
*               title:
*                 type: string
*                 description: Product title
*               price:
*                 type: number
*                 description: Product price
*               quantity:
*                 type: number
*                 description: Product quantity
*               category:
*                 type: string
*                 description: Category ID
*               brand:
*                 type: string
*                 description: Product brand
*               description:
*                 type: string
*                 description: Product description
*     responses:
*       200:
*         description: Created product information with store details
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 title:
*                   type: string
*                 price:
*                   type: number
*                 listedPrice:
*                   type: number
*                 quantity:
*                   type: number
*                 category:
*                   type: string
*                 brand:
*                   type: string
*                 description:
*                   type: string
*                 store:
*                   type: object
*                   properties:
*                     name:
*                       type: string
*                     image:
*                       type: string
*       400:
*         description: Validation fails or creation fails
*/
router.post("/create-product", authMiddleware, isSeller, createProduct);
/**
 * @swagger
 * /get-product:
 *   get:
 *     summary: Get a single product by ID
 *     description: Get a single product by ID
 *     tags:
 *       - Products
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
*           schema:
*             type: object
*             required:
*               - id
*             properties:
*               id:
*                 type: string
*                 description: Product ID
*     responses:
*       200:
*         description: Product information with store details
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 title:
*                   type: string
*                 price:
*                   type: number
*                 listedPrice:
*                   type: number
*                 quantity:
*                   type: number
*                 category:
*                   type: string
*                 brand:
*                   type: string
*                 description:
*                   type: string
*                 store:
*                   type: object
*                   properties:
*                     name:
*                       type: string
*                     image:
*                       type: string
*       400:
*         description: Validation fails or product not found
*/
router.get("/get-product", getAProduct);
/**
 * @swagger
 * /update/:id:
 *   put:
 *     summary: Update an existing product
 *     description: Update an existing product
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
*             properties:
*               title:
*                 type: string
*                 description: Updated product title
*               price:
*                 type: number
*                 description: Updated product price
*               quantity:
*                 type: number
*                 description: Updated product quantity
*               category:
*                 type: string
*                 description: Updated category ID
*               brand:
*                 type: string
*                 description: Updated product brand
*               description:
*                 type: string
*                 description: Updated product description
*     responses:
*       200:
*         description: Updated product information
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 _id:
*                   type: string
*                 title:
*                   type: string
*                 price:
*                   type: number
*                 listedPrice:
*                   type: number
*                 quantity:
*                   type: number
*                 category:
*                   type: string
*                 brand:
*                   type: string
*                 description:
*                   type: string
*                 store:
*                   type: object
*                   properties:
*                     name:
*                       type: string
*                     image:
*                       type: string
*       400:
*         description: Validation fails or product not found
*/
router.put("/:id", updateProduct);
/**
 * @swagger
 * /delete/:id:
 *   delete:
 *     summary: Delete a product
 *     description: Delete a product
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Product ID
 *     responses:
 *       200:
 *         description: Deletion status message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
*               properties:
*                 message:
*                   type: string
*       400:
*         description: Deletion fails
*/
router.delete("/:id", authMiddleware, isSeller, deleteProduct);
/**
 * @swagger
 * /get-products:
 *   get:
 *     summary: Get paginated list of all products with store details
 *     description: Get paginated list of all products with store details
 *     tags:
 *       - Products
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
*           default: 30
*         description: Number of products per page
*     responses:
*       200:
*         description: Paginated list of products with store details
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 data:
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
*                 totalProducts:
*                   type: number
*                 totalPages:
*                   type: number
*                 currentPage:
*                   type: number
*       400:
*         description: Retrieval fails
*/
router.get("/get-products", getAllProducts);
/**
 * @swagger
 * /products/category:
 *   get:
 *     summary: Get products by category
 *     description: Get products by category
 *     tags:
 *       - Products
 *     parameters:
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
*           required: true
*         description: Category ID
*     responses:
*       200:
*         description: List of products in the specified category
*         content:
*           application/json:
*             schema:
*               type: array
*               items:
*                 type: object
*                 properties:
*                   _id:
*                     type: string
*                   title:
*                     type: string
*                   price:
*                     type: number
*                   listedPrice:
*                     type: number
*                   quantity:
*                     type: number
*                   category:
*                     type: string
*                   brand:
*                     type: string
*                   description:
*                     type: string
*                   store:
*                     type: object
*                     properties:
*                       name:
*                         type: string
*                       image:
*                         type: string
*       400:
*         description: Retrieval fails
*/
router.get("/products/category", getProductsByCategory); // Get products by category
/**
 * @swagger
 * /category:
 *   delete:
 *     summary: Delete a product category and its associated products
 *     description: Delete a product category and its associated products
 *     tags:
 *       - Products
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
*             required:
*               - id
*             properties:
*               id:
*                 type: string
*                 description: Category ID
*     responses:
*       200:
*         description: Deletion status message
*         content:
*           application/json:
*             schema:
*               type: object
*               properties:
*                 message:
*                   type: string
*       400:
*         description: Category ID is invalid
*/
router.delete("/category", authMiddleware, isAdmin, deleteProductCategory); // Delete product category
/**
 * @swagger
 * /categories:
 *   get:
 *     summary: Get all product categories
 *     description: Get all product categories
 *     tags:
 *       - Products
 *     responses:
 *       200:
 *         description: List of all product categories
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
*       400:
*         description: Retrieval fails
*/
router.get("/categories", getProductCategories); // Get all product categories


module.exports = router;
