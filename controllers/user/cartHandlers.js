/**
 * Cart endpoints under /api/user. Thin wrappers over services/cartService; each
 * one answers with the same cart view, so the cart screen can re-render from
 * any response.
 */
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const cart = require("../../services/cartService");

const fail = (res, err) => {
  if (err instanceof cart.CartError) {
    return res.status(err.status).json({ success: false, message: err.message });
  }
  throw err;
};

const respond = async (res, userId, message) =>
  res.json({ success: true, ...(message && { message }), data: await cart.cartView(userId) });

/** GET /api/user/get-cart */
const getUserCart = asyncHandler(async (req, res) => respond(res, req.user._id));

/**
 * POST /api/user/add-cart
 * Body: { productId, count = 1 }. The legacy { product: { _id, count } } body is
 * still accepted; any client-sent store is ignored.
 */
const addToCart2 = asyncHandler(async (req, res) => {
  const productId = req.body.productId ?? req.body.product?._id;
  const count = cart.parseCount(req.body.count ?? req.body.product?.count ?? 1);
  if (!productId) return res.status(400).json({ success: false, message: "productId is required" });
  if (count === null) {
    return res.status(400).json({ success: false, message: "count must be a whole number of at least 1" });
  }
  validateMongodbId(productId);
  try {
    await cart.addToCart(req.user._id, productId, count);
  } catch (err) {
    return fail(res, err);
  }
  return respond(res, req.user._id, "Product added to cart");
});

/** PUT /api/user/update-cart — Body: { productId, newCount }. 0 removes the line. */
const updateCart = asyncHandler(async (req, res) => {
  const { productId } = req.body;
  const count = cart.parseCount(req.body.newCount ?? req.body.count, { min: 0 });
  if (!productId) return res.status(400).json({ success: false, message: "productId is required" });
  if (count === null) {
    return res.status(400).json({ success: false, message: "newCount must be a whole number of 0 or more" });
  }
  validateMongodbId(productId);
  try {
    await cart.setCartQuantity(req.user._id, productId, count);
  } catch (err) {
    return fail(res, err);
  }
  return respond(res, req.user._id, count === 0 ? "Product removed from cart" : "Cart updated");
});

/** DELETE /api/user/cart/:productId — idempotent. */
const removeFromCart = asyncHandler(async (req, res) => {
  const productId = req.params.productId ?? req.body?.productId;
  if (!productId) return res.status(400).json({ success: false, message: "productId is required" });
  validateMongodbId(productId);
  await cart.removeFromCart(req.user._id, productId);
  return respond(res, req.user._id, "Product removed from cart");
});

/** POST /api/user/empty-cart */
const emptyCart = asyncHandler(async (req, res) => {
  const Cart = require("../../models/cartModel");
  await Cart.deleteOne({ owner: req.user._id });
  return respond(res, req.user._id, "Cart emptied");
});

module.exports = { getUserCart, addToCart2, updateCart, removeFromCart, emptyCart };
