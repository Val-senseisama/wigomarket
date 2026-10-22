const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const { isStorePublic } = require("../../utils/storeVisibility");
const { serializePublicStore } = require("../../utils/storeSettings");
const { getStoreRating } = require("../../utils/storeRating");

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
  store.rating = await getStoreRating(store._id);
  res.json(serializePublicStore(store));
});

module.exports = getAStore;
