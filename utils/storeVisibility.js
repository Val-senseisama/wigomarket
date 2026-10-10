/**
 * Which shops the public may see.
 *
 * A shop is off the storefront when the seller hid it (isVisible: false) or an
 * admin suspended it. Its page 404s, it is left out of every store listing, and
 * its products are left out of every product listing, search and suggestion —
 * the products' own `status` is untouched, so un-hiding the shop restores them
 * exactly as they were.
 *
 * Store queries match on PUBLIC_STORE_MATCH directly. Product queries cannot
 * see the store's fields, so they exclude the hidden shops' ids instead.
 */
const Store = require("../models/storeModel");

const PUBLIC_STORE_MATCH = { isVisible: { $ne: false }, status: { $ne: "suspended" } };
const HIDDEN_STORE_MATCH = { $or: [{ isVisible: false }, { status: "suspended" }] };

const isStorePublic = (store) =>
  Boolean(store) && store.isVisible !== false && store.status !== "suspended";

/** Ids of every shop the public must not see. */
const hiddenStoreIds = () => Store.distinct("_id", HIDDEN_STORE_MATCH);

/**
 * Filter fragment for a public product query: `{ store: { $nin: [...] } }`,
 * or `{}` when no shop is hidden. Merge it into the query's own filter.
 */
const visibleStoreProductFilter = async () => {
  const ids = await hiddenStoreIds();
  return ids.length ? { store: { $nin: ids } } : {};
};

/**
 * Return `filter` narrowed to products of public shops. Safe when `filter`
 * already constrains `store` (a storefront page): the exclusion goes in `$and`
 * rather than overwriting it.
 */
const withVisibleStores = async (filter = {}) => {
  const fragment = await visibleStoreProductFilter();
  if (!fragment.store) return filter;
  if (filter.store === undefined) return { ...filter, ...fragment };
  return { ...filter, $and: [...(filter.$and || []), fragment] };
};

module.exports = {
  PUBLIC_STORE_MATCH,
  HIDDEN_STORE_MATCH,
  isStorePublic,
  hiddenStoreIds,
  visibleStoreProductFilter,
  withVisibleStores,
};
