/**
 * The viewer's own state on a product card: the heart (saved) and the cart
 * button (already in cart, and how many).
 *
 * Every buyer-facing product response — get-products, home suggested-products,
 * category suggestions, search, the saved-products screen, product detail —
 * answers these the same way, from the user's single Wishlist and Cart
 * documents, so a product shows the same state wherever it appears.
 *
 * This is per viewer, so it is never part of a cached payload: cache the shared
 * result, then mark it on the way out.
 */
const Wishlist = require("../models/wishlistModel");
const Cart = require("../models/cartModel");

/**
 * @returns {Promise<{ saved: Set<string>, inCart: Map<string, number> }>}
 *   saved product ids, and cart quantity per product id. Empty for guests.
 */
const viewerProductState = async (userId) => {
  if (!userId) return { saved: new Set(), inCart: new Map() };
  const [wishlist, cart] = await Promise.all([
    Wishlist.findOne({ user: userId }, "products.product").lean(),
    Cart.findOne({ owner: userId }, "products.product products.count").lean(),
  ]);
  const inCart = new Map();
  for (const line of cart?.products || []) {
    if (!line.product) continue;
    const id = String(line.product);
    inCart.set(id, (inCart.get(id) || 0) + (line.count || 0));
  }
  return {
    saved: new Set((wishlist?.products || []).map((item) => String(item.product))),
    inCart,
  };
};

/** The three viewer fields for one product id. */
const stateFor = ({ saved, inCart }, id) => {
  const key = String(id);
  const cartQuantity = inCart.get(key) || 0;
  return { isInWishlist: saved.has(key), isInCart: cartQuantity > 0, cartQuantity };
};

/**
 * Set `isInWishlist`, `isInCart` and `cartQuantity` on each item, in place.
 * Two reads for the whole list; everything is false/0 for a guest.
 *
 * @param {string|ObjectId|null|undefined} userId - Viewer, or null for a guest
 * @param {Object[]} items - Product cards; the id is read from `id` or `_id`
 * @returns {Promise<Object[]>} the same array
 */
const markViewerState = async (userId, items) => {
  const list = Array.isArray(items) ? items : [];
  const state = await viewerProductState(userId);
  for (const item of list) Object.assign(item, stateFor(state, item.id ?? item._id));
  return list;
};

module.exports = { viewerProductState, stateFor, markViewerState };
