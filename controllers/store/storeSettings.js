const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const { deleteByPatterns } = require("../../utils/redisKeys");
const audit = require("../../services/auditService");
const {
  parseOpeningHours,
  parseFulfilmentOptions,
  serializeStoreSettings,
} = require("../../utils/storeSettings");

// Cached public product listings that may still include a shop that was just
// hidden (or omit one just re-shown). Cleared on every visibility change so
// the toggle takes effect immediately rather than after the cache TTL.
const LISTING_CACHE_PATTERNS = [
  "products:*",
  "personalized:*",
  "trending:*",
  "category_suggestions:*",
  "search:*",
  "suggestions:*",
  "home:*",
];

const clearListingCaches = async () => {
  try {
    await deleteByPatterns(LISTING_CACHE_PATTERNS);
  } catch (error) {
    console.error("[StoreSettings] listing cache clear failed:", error.message);
  }
};

const noStore = (res) =>
  res.status(404).json({ success: false, message: "No store found for this account" });

/**
 * @function getStoreSettings
 * @description The seller's shop preferences: visibility, opening hours (with
 * whether the shop is open right now) and fulfilment options.
 */
const getStoreSettings = asyncHandler(async (req, res) => {
  if (!req.store) return noStore(res);
  const store = await Store.findById(req.store, "isVisible openingHours fulfilmentOptions").lean();
  if (!store) return noStore(res);
  res.json({ success: true, data: serializeStoreSettings(store) });
});

/**
 * @function updateStoreSettings
 * @description Partial update of shop preferences. Send any of:
 * @param {boolean} [req.body.isVisible] - false hides the shop and all its products from buyers
 * @param {Object|null} [req.body.openingHours] - { timezone?, days: [{ day, isOpen, open, close }] }; null clears
 * @param {string[]} [req.body.fulfilmentOptions] - non-empty subset of ["delivery", "pickup"]
 */
const updateStoreSettings = asyncHandler(async (req, res) => {
  if (!req.store) return noStore(res);
  const body = req.body || {};
  const bad = (message) => res.status(400).json({ success: false, message });
  const $set = {};
  const $unset = {};

  if (body.isVisible !== undefined) {
    if (typeof body.isVisible !== "boolean") return bad("isVisible must be true or false");
    $set.isVisible = body.isVisible;
  }

  if (body.openingHours !== undefined) {
    if (body.openingHours === null) {
      $unset.openingHours = 1;
    } else {
      const parsed = parseOpeningHours(body.openingHours);
      if (parsed.error) return bad(parsed.error);
      $set.openingHours = parsed.value;
    }
  }

  if (body.fulfilmentOptions !== undefined) {
    const parsed = parseFulfilmentOptions(body.fulfilmentOptions);
    if (parsed.error) return bad(parsed.error);
    $set.fulfilmentOptions = parsed.value;
  }

  if (!Object.keys($set).length && !Object.keys($unset).length) {
    return bad("Send at least one of: isVisible, openingHours, fulfilmentOptions");
  }

  const before = await Store.findById(req.store, "isVisible").lean();
  if (!before) return noStore(res);

  const store = await Store.findByIdAndUpdate(
    req.store,
    { ...(Object.keys($set).length && { $set }), ...(Object.keys($unset).length && { $unset }) },
    { new: true, runValidators: true, projection: "name isVisible openingHours fulfilmentOptions" },
  ).lean();

  const visibilityChanged =
    $set.isVisible !== undefined && (before.isVisible !== false) !== $set.isVisible;
  if (visibilityChanged) await clearListingCaches();

  audit.log({
    action: "store.settings_updated",
    actor: audit.actor(req),
    resource: { type: "store", id: req.store, displayName: store?.name },
    changes: { after: { ...$set, ...($unset.openingHours && { openingHours: null }) } },
  });

  res.json({
    success: true,
    message: "Store settings updated",
    data: serializeStoreSettings(store),
  });
});

module.exports = { getStoreSettings, updateStoreSettings };
