const express = require("express");
const {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");
const { authMiddleware, isSeller } = require("../middleware/authMiddleware");
const router = express.Router();

router.post("/create-product", authMiddleware, isSeller, createProduct);
router.get("/get-product/:id", getAProduct);
router.put("/:id", updateProduct);
router.delete("/:id", authMiddleware, isSeller, deleteProduct);
router.get("/get-product", getAllProducts);

module.exports = router;
