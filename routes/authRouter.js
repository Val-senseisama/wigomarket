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
} = require("../controllers/userController");
const { authMiddleware, isAdmin } = require("../middleware/authMiddleware");
const { commissionHandler } = require("../controllers/paymentController");
const router = express.Router();

router.post("/register", createUser);
router.post("/forgot-password-token", forgotPasswordToken);
router.put("/reset-password/:token", resetPassword);
router.post("/login", loginUser);
router.get("/all-users", getAllUsers);
router.get("/refresh", handleRefreshToken);
router.get("logout", logoutUser);
router.get("/get-cart", authMiddleware, getUserCart);
router.get("/:id", authMiddleware, isAdmin, getAUser);
router.put("/edit-user", authMiddleware, updateAUser);
router.post("/pay", authMiddleware, commissionHandler);
router.delete("/:id", deleteAUser);
router.put("/block-user/:id", authMiddleware, isAdmin, blockUser);
router.put("/unblock-user/:id", authMiddleware, isAdmin, unblockUser);
router.get("/get-cart", authMiddleware, getUserCart);
router.put("/update-cart", authMiddleware, updateCart);
router.post("/add-cart", authMiddleware, addToCart2);
router.post("/empty-cart", authMiddleware, emptyCart);
router.post("/create-order", authMiddleware, createOrder);
router.post("/verify", verifyOtp);

module.exports = router;
