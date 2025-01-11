const express = require("express");
const {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  createProductCategory,
  updateProductCategory,
} = require("../controllers/productController");
const { authMiddleware, isSeller, isAdmin } = require("../middleware/authMiddleware");
const router = express.Router();
router.post("/create-category", authMiddleware, isAdmin, createProductCategory);
router.put("/update-category", authMiddleware, isAdmin, updateProductCategory)
router.post("/create-product", authMiddleware, isSeller, createProduct);
router.get("/get-product", getAProduct);
router.put("/:id", updateProduct);
router.delete("/:id", authMiddleware, isSeller, deleteProduct);
router.get("/get-product", getAllProducts);

module.exports = router;
