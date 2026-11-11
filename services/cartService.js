/**
 * The buyer's cart: one document per user (models/cartModel), one line per
 * product.
 *
 * Rules every cart endpoint shares:
 *   - A line's store always comes from the product, never from the client — it
 *     decides which seller is paid for the order line.
 *   - Prices are never trusted from storage on read: the cart view prices each
 *     line at the product's current listedPrice. The stored `price` /
 *     `cartTotal` are recomputed on every write (and createOrder recomputes
 *     again inside its transaction).
 *   - A line that can no longer be bought (out of stock, not enough stock,
 *     product hidden, shop hidden) stays in the cart, flagged, and is left out
 *     of the total — it is not silently deleted. Only lines whose product was
 *     deleted are pruned.
 */
const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const money = require("../utils/money");
const { serializeBuyerCard } = require("../utils/productSerializer");
const { isStorePublic } = require("../utils/storeVisibility");
const { markViewerState } = require("../utils/viewerProductState");

const PRODUCT_FIELDS =
  "title images listedPrice listedCompareAtPrice price quantity productType variants.listedPrice rating status store";

/** Why a line cannot be bought right now, or null. */
const lineIssue = (product, count) => {
  if (!product) return "unavailable";
  if (product.status === "hidden" || !isStorePublic(product.store)) return "unavailable";
  if ((product.quantity ?? 0) <= 0) return "out_of_stock";
  if (count > product.quantity) return "insufficient_stock";
  return null;
};

const ISSUE_MESSAGES = {
  unavailable: "This product is no longer available",
  out_of_stock: "Out of stock",
  insufficient_stock: "Only a few left — reduce the quantity",
};

const unitPriceOf = (product) => product.listedPrice ?? product.price ?? 0;

/**
 * Load the cart and build the response shape the cart screen renders.
 *
 * @returns {Promise<Object>} {
 *   items: [{ productId, product (buyer card), count, unitPrice, lineTotal,
 *             store: { id, name }, available, issue, issueMessage, maxQuantity }],
 *   itemCount, lineCount, cartTotal, currency, hasUnavailableItems }
 */
const cartView = async (userId) => {
  const cart = await Cart.findOne({ owner: userId }, "products").lean();
  const raw = cart?.products || [];

  const products = raw.length
    ? await Product.find({ _id: { $in: raw.map((l) => l.product) } }, PRODUCT_FIELDS)
        .populate("store", "name isVisible status")
        .lean()
    : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));

  // A deleted product leaves a dangling id behind; drop those lines for good.
  const gone = raw.filter((l) => !byId.has(String(l.product))).map((l) => l.product);
  if (gone.length) {
    await Cart.updateOne({ owner: userId }, { $pull: { products: { product: { $in: gone } } } });
  }
  const lines = raw
    .filter((l) => byId.has(String(l.product)))
    .map((l) => ({ ...l, product: byId.get(String(l.product)) }));

  const items = lines.map((line) => {
      const product = line.product;
      const unitPrice = unitPriceOf(product);
      const issue = lineIssue(product, line.count);
      const card = serializeBuyerCard(product);
      return {
        productId: product._id,
        product: card,
        count: line.count,
        unitPrice,
        lineTotal: money.multiply(unitPrice, line.count),
        store: card.store,
        available: issue === null,
        issue,
        issueMessage: issue ? ISSUE_MESSAGES[issue] : null,
        maxQuantity: Math.max(0, product.quantity ?? 0),
      };
    });

  // Same heart/cart fields as every other product card.
  await markViewerState(userId, items.map((i) => i.product));

  const payable = items.filter((i) => i.available);
  return {
    items,
    itemCount: payable.reduce((n, i) => n + i.count, 0),
    lineCount: items.length,
    cartTotal: money.sum(payable, (i) => i.lineTotal),
    currency: "NGN",
    hasUnavailableItems: payable.length !== items.length,
  };
};

/**
 * A product a buyer may put in the cart, with its store populated.
 * @returns {Promise<Object|null>}
 */
const findBuyableProduct = async (productId) => {
  const product = await Product.findById(productId, PRODUCT_FIELDS)
    .populate("store", "name isVisible status")
    .lean();
  if (!product || product.status === "hidden" || !isStorePublic(product.store)) return null;
  return product;
};

/**
 * Re-price every line at the product's current listedPrice and recompute
 * cartTotal, then save. Lines are priced even if unavailable; createOrder
 * rejects those before charging.
 */
const repriceAndSave = async (cart) => {
  const ids = cart.products.map((l) => l.product);
  const products = await Product.find({ _id: { $in: ids } }, "listedPrice price store").lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  for (const line of cart.products) {
    const product = byId.get(String(line.product));
    if (!product) continue;
    line.price = money.multiply(unitPriceOf(product), line.count);
    line.store = product.store; // always the product's own shop
  }
  cart.cartTotal = money.sum(cart.products, (l) => l.price || 0);
  await cart.save();
};

/** Thrown for a request the client can fix; carries an HTTP status. */
class CartError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Add `count` units of a product (adds to an existing line).
 * @throws {CartError}
 */
const addToCart = async (userId, productId, count) => {
  const product = await findBuyableProduct(productId);
  if (!product) throw new CartError(404, "Product not found");

  const cart =
    (await Cart.findOne({ owner: userId })) ||
    new Cart({ owner: userId, products: [], cartTotal: 0 });

  const line = cart.products.find((l) => String(l.product) === String(productId));
  const newCount = (line?.count || 0) + count;

  if ((product.quantity ?? 0) <= 0) throw new CartError(400, "This product is out of stock");
  if (newCount > product.quantity) {
    throw new CartError(
      400,
      `Only ${product.quantity} in stock${line ? ` and you already have ${line.count} in your cart` : ""}`,
    );
  }

  if (line) line.count = newCount;
  else cart.products.push({ product: productId, count, store: product.store._id, price: 0 });

  await repriceAndSave(cart);
};

/**
 * Set a line's quantity. 0 removes the line.
 * @throws {CartError}
 */
const setCartQuantity = async (userId, productId, count) => {
  const cart = await Cart.findOne({ owner: userId });
  const line = cart?.products.find((l) => String(l.product) === String(productId));
  if (!line) throw new CartError(404, "Product not found in cart");

  if (count === 0) {
    cart.products = cart.products.filter((l) => String(l.product) !== String(productId));
    return repriceAndSave(cart);
  }

  const product = await Product.findById(productId, "quantity").lean();
  if (!product) throw new CartError(404, "Product not found");
  if (count > (product.quantity ?? 0)) {
    throw new CartError(400, `Only ${product.quantity ?? 0} in stock`);
  }
  line.count = count;
  await repriceAndSave(cart);
};

/** Remove a product's line. Idempotent. */
const removeFromCart = async (userId, productId) => {
  const cart = await Cart.findOne({ owner: userId });
  if (!cart) return;
  const before = cart.products.length;
  cart.products = cart.products.filter((l) => String(l.product) !== String(productId));
  if (cart.products.length !== before) await repriceAndSave(cart);
};

/** Parse a quantity from a request: a whole number ≥ min, or null. */
const parseCount = (raw, { min = 1 } = {}) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= 10000 ? n : null;
};

module.exports = {
  cartView,
  addToCart,
  setCartQuantity,
  removeFromCart,
  parseCount,
  CartError,
};
