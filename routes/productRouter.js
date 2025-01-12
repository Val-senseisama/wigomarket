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
router.post("/create-category", authMiddleware, isAdmin, createProductCategory);
router.put("/update-category", authMiddleware, isAdmin, updateProductCategory)
router.post("/create-product", authMiddleware, isSeller, createProduct);
router.get("/get-product", getAProduct);
router.put("/:id", updateProduct);
router.delete("/:id", authMiddleware, isSeller, deleteProduct);
router.get("/get-products", getAllProducts);
router.get("/products/category", getProductsByCategory); // Get products by category
router.delete("/category", authMiddleware, isAdmin, deleteProductCategory); // Delete product category
router.get("/categories", getProductCategories); // Get all product categories


module.exports = router;
