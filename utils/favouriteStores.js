/**
 * The heart on a vendor card: has this viewer saved the shop?
 *
 * Every store card (home top-shops, nearby-shops, popular-vendors, search,
 * the favourite-vendors screen) and the store page answer it the same way.
 * Per viewer, so never part of a cached payload — mark after the cache.
 */
const FavouriteStore = require("../models/favouriteStoreModel");

/**
 * Set `isFavourite` on each store, in place. One query for the whole list;
 * false for a guest.
 *
 * @param {string|ObjectId|null|undefined} userId
 * @param {Object[]} stores - Store cards; the id is read from `_id` or `id`
 * @returns {Promise<Object[]>} the same array
 */
const markFavouriteStores = async (userId, stores) => {
  const list = Array.isArray(stores) ? stores : [];
  let favourites = new Set();
  if (userId && list.length) {
    const rows = await FavouriteStore.find(
      { user: userId, store: { $in: list.map((s) => s._id ?? s.id).filter(Boolean) } },
      "store",
    ).lean();
    favourites = new Set(rows.map((r) => String(r.store)));
  }
  for (const store of list) store.isFavourite = favourites.has(String(store._id ?? store.id));
  return list;
};

module.exports = { markFavouriteStores };
