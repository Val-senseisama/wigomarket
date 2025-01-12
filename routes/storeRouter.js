const express = require("express");
const {
  search,
  getAStore,
  getAllStores,
  createStore,
  getMyStore,
} = require("../controllers/storeController");
const { authMiddleware, isSeller } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/create", authMiddleware, createStore);
router.get("/my-store", authMiddleware, isSeller, getMyStore);
router.get("/all", getAllStores);
router.get("/:id", getAStore);
router.get("/", search);

module.exports = router;
