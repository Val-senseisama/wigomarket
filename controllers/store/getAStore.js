const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const { isStorePublic } = require("../../utils/storeVisibility");
const { serializePublicStore } = require("../../utils/storeSettings");
const { getStoreRating } = require("../../utils/storeRating");
const FavouriteStore = require("../../models/favouriteStoreModel");

/**
 * @function getAStore
 * @description Public storefront view of a single store. A hidden or suspended
 * shop is 404 (its owner uses GET /api/store/my-store). Owner-only fields —
 * NIN, bank and payout details, balance — are never included. `rating` is
 * computed from its products' reviews, the same way the home cards do it.
 * @param {string} req.params.id - Store ID (required)
 * @returns {Object} - Store information, plus openingHours, isOpenNow and fulfilmentOptions
 */
const getAStore = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  const store = await Store.findById(id).lean();
  if (!isStorePublic(store)) {
    return res.status(404).json({ success: false, message: "Store not found" });
  }
  const [rating, favourite] = await Promise.all([
    getStoreRating(store._id),
    req.user ? FavouriteStore.exists({ user: req.user._id, store: store._id }) : null,
  ]);
  store.rating = rating;
  // The heart on the shop page — same flag as on the vendor cards.
  res.json({ ...serializePublicStore(store), isFavourite: Boolean(favourite) });
});

module.exports = getAStore;
