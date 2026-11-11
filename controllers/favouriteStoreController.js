const asyncHandler = require("express-async-handler");
const Store = require("../models/storeModel");
const FavouriteStore = require("../models/favouriteStoreModel");
const validateMongodbId = require("../utils/validateMongodbId");
const { isStorePublic, PUBLIC_STORE_MATCH } = require("../utils/storeVisibility");
const { RATED_PRODUCT_MATCH, ratingFields } = require("../utils/storeRating");
const { haversineMeters } = require("../utils/routeGeometry");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const CITY_SPEED_KM_PER_MIN = 0.5; // 30 km/h, as on the home cards

/**
 * Store cards for the given ids — the same fields as the home vendor cards
 * (GET /api/home/popular-vendors), with distance when the caller's location
 * is known. Returned in the order of `ids`.
 */
const storeCards = async (ids, { lat, lng } = {}) => {
  if (!ids.length) return [];
  const rows = await Store.aggregate([
    { $match: { _id: { $in: ids } } },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "store",
        as: "products",
        pipeline: [
          { $match: RATED_PRODUCT_MATCH },
          { $project: { quantity: 1, listedPrice: 1, "rating.average": 1, "rating.count": 1 } },
        ],
      },
    },
    {
      $addFields: {
        _inStock: { $filter: { input: "$products", cond: { $gt: ["$$this.quantity", 0] } } },
      },
    },
    {
      $addFields: {
        averagePrice: {
          $cond: {
            if: { $gt: [{ $size: "$_inStock" }, 0] },
            then: { $round: [{ $avg: "$_inStock.listedPrice" }, 0] },
            else: null,
          },
        },
        ...ratingFields(),
      },
    },
    {
      $project: {
        _id: 1,
        name: 1,
        image: 1,
        address: 1,
        description: 1,
        businessType: 1,
        city: 1,
        averagePrice: 1,
        location: 1,
        rating: {
          average: { $round: ["$rating.average", 1] },
          count: "$rating.count",
        },
      },
    },
  ]);

  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng);
  const byId = new Map(
    rows.map(({ location, ...card }) => {
      const coords = location?.coordinates;
      if (hasLocation && Array.isArray(coords) && coords.length === 2) {
        const distanceKm = Math.round(haversineMeters(lat, lng, coords[1], coords[0]) / 100) / 10;
        card.distanceKm = distanceKm;
        card.travelTimeMin = Math.ceil(distanceKm / CITY_SPEED_KM_PER_MIN);
      }
      return [String(card._id), card];
    }),
  );
  return ids.map((id) => byId.get(String(id))).filter(Boolean);
};

/** 404 unless the shop is on the storefront (not hidden or suspended). */
const findPublicStore = async (storeId) => {
  const store = await Store.findById(storeId, "isVisible status").lean();
  return isStorePublic(store) ? store : null;
};

/**
 * @function addFavouriteStore
 * @description Save a shop as a favourite — the heart on a vendor card.
 *   Idempotent: saving an already-saved shop returns 200 unchanged.
 * @route PUT /api/favourites/stores/:storeId
 */
const addFavouriteStore = asyncHandler(async (req, res) => {
  const { storeId } = req.params;
  validateMongodbId(storeId);

  if (!(await findPublicStore(storeId))) {
    return res.status(404).json({ success: false, message: "Store not found" });
  }

  // Upsert on the unique (user, store) index: a double tap is a no-op.
  await FavouriteStore.updateOne(
    { user: req.user._id, store: storeId },
    { $setOnInsert: { user: req.user._id, store: storeId } },
    { upsert: true },
  ).catch((err) => {
    if (err?.code !== 11000) throw err; // a concurrent save won the race
  });

  const totalItems = await FavouriteStore.countDocuments({ user: req.user._id });
  res.json({
    success: true,
    message: "Store added to favourites",
    data: { storeId, isFavourite: true, totalItems },
  });
});

/**
 * @function removeFavouriteStore
 * @description Remove a shop from favourites. Idempotent.
 * @route DELETE /api/favourites/stores/:storeId
 */
const removeFavouriteStore = asyncHandler(async (req, res) => {
  const { storeId } = req.params;
  validateMongodbId(storeId);

  await FavouriteStore.deleteOne({ user: req.user._id, store: storeId });
  const totalItems = await FavouriteStore.countDocuments({ user: req.user._id });
  res.json({
    success: true,
    message: "Store removed from favourites",
    data: { storeId, isFavourite: false, totalItems },
  });
});

/**
 * @function getFavouriteStores
 * @description The favourite-vendors screen: the user's saved shops as vendor
 *   cards, most recently saved first. Shops that are hidden or suspended are
 *   left out but stay saved, and reappear if restored.
 * @route GET /api/favourites/stores
 * @query {number} [page=1]
 * @query {number} [limit=20] - Max 50
 * @query {number} [lat] / [lng] - Adds distanceKm and travelTimeMin
 */
const getFavouriteStores = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));

  const favourites = await FavouriteStore.find({ user: req.user._id }, "store createdAt")
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  const savedAt = new Map(favourites.map((f) => [String(f.store), f.createdAt]));

  const visible = favourites.length
    ? await Store.find(
        { _id: { $in: favourites.map((f) => f.store) }, ...PUBLIC_STORE_MATCH },
        "_id",
      ).lean()
    : [];
  const visibleIds = new Set(visible.map((s) => String(s._id)));
  const ordered = favourites.map((f) => f.store).filter((id) => visibleIds.has(String(id)));

  const total = ordered.length;
  const pageIds = ordered.slice((page - 1) * limit, page * limit);

  const cards = await storeCards(pageIds, {
    lat: parseFloat(req.query.lat),
    lng: parseFloat(req.query.lng),
  });

  res.json({
    success: true,
    data: cards.map((card) => ({
      ...card,
      isFavourite: true,
      savedAt: savedAt.get(String(card._id)) || null,
    })),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 0,
      hasMore: page * limit < total,
    },
  });
});

module.exports = { addFavouriteStore, removeFavouriteStore, getFavouriteStores };
