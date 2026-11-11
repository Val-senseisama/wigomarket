const asyncHandler = require("express-async-handler");
const Wishlist = require("../models/wishlistModel");
const Product = require("../models/productModel");
const { ThrowError } = require("../Helpers/Helpers");
const validateMongodbId = require("../utils/validateMongodbId");
const { serializeBuyerCard } = require("../utils/productSerializer");
const { markViewerState } = require("../utils/viewerProductState");
const { withVisibleStores, isStorePublic } = require("../utils/storeVisibility");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/**
 * One page of a wishlist as buyer product cards — the same card as
 * GET /api/product/get-products, newest save first.
 *
 * Products that are hidden, or whose shop is hidden or suspended, are left out
 * of the page (they would 404 when tapped) but stay in the wishlist, so they
 * come back if the seller restores them. Out-of-stock products are kept; the
 * card's displayStatus says so.
 *
 * @param {Object|null} wishlist - Lean Wishlist document
 * @param {Object} query - req.query (page, limit)
 */
const savedProductsPage = async (wishlist, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(query.limit, 10) || DEFAULT_PAGE_SIZE));

  const entries = [...(wishlist?.products || [])].sort(
    (a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0),
  );
  const savedAt = new Map(entries.map((e) => [String(e.product), e.addedAt || null]));

  const visible = entries.length
    ? await Product.find(
        await withVisibleStores({
          _id: { $in: entries.map((e) => e.product) },
          status: { $ne: "hidden" },
        }),
        "_id",
      ).lean()
    : [];
  const visibleIds = new Set(visible.map((p) => String(p._id)));
  const ordered = entries.map((e) => String(e.product)).filter((id) => visibleIds.has(id));

  const total = ordered.length;
  const pageIds = ordered.slice((page - 1) * limit, page * limit);

  const docs = pageIds.length
    ? await Product.find({ _id: { $in: pageIds } })
        .populate("store", "name")
        .lean()
    : [];
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  const data = pageIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((doc) => ({
      ...serializeBuyerCard(doc),
      savedAt: savedAt.get(String(doc._id)),
    }));

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 0,
      hasMore: page * limit < total,
    },
  };
};

/** A product a buyer can see: exists, not hidden, and its shop is public. */
const findPublicProduct = async (productId) => {
  const product = await Product.findById(productId, "status store")
    .populate("store", "isVisible status")
    .lean();
  if (!product || product.status === "hidden" || !isStorePublic(product.store)) return null;
  return product;
};

/**
 * @function addToWishlist
 * @description Save a product — the heart on a product card and the save
 *   button on the product page. Idempotent: saving an already-saved product
 *   succeeds and changes nothing, so a double tap is harmless.
 * @param {string} req.body.productId - Product to save
 * @param {string} [req.body.notes] - Optional note
 * @returns {Object} - { productId, isInWishlist: true, totalItems }
 */
const addToWishlist = asyncHandler(async (req, res) => {
  const { productId, notes = "" } = req.body;
  const userId = req.user._id;

  validateMongodbId(productId);

  if (!(await findPublicProduct(productId))) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  const wishlist = await Wishlist.getOrCreateWishlist(userId);

  // Conditional push: two concurrent saves cannot add the product twice.
  await Wishlist.updateOne(
    { _id: wishlist._id, "products.product": { $ne: productId } },
    {
      $push: { products: { product: productId, addedAt: new Date(), notes: String(notes || "").slice(0, 500) } },
      $set: { lastUpdated: new Date() },
    },
  );
  const totalItems = await syncTotalItems(wishlist._id);

  res.json({
    success: true,
    message: "Product saved",
    data: { productId, isInWishlist: true, totalItems },
  });
});

/**
 * @function removeFromWishlist
 * @description Unsave a product. Idempotent: removing a product that is not
 *   saved succeeds, so the heart can always be un-toggled.
 * @param {string} req.params.productId - Product to remove
 * @returns {Object} - { productId, isInWishlist: false, totalItems }
 */
const removeFromWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const userId = req.user._id;

  validateMongodbId(productId);

  const wishlist = await Wishlist.findOneAndUpdate(
    { user: userId },
    { $pull: { products: { product: productId } }, $set: { lastUpdated: new Date() } },
    { new: true, projection: { _id: 1 } },
  ).lean();
  const totalItems = wishlist ? await syncTotalItems(wishlist._id) : 0;

  res.json({
    success: true,
    message: "Product removed from saved items",
    data: { productId, isInWishlist: false, totalItems },
  });
});

/**
 * Recount totalItems from the array itself. updateOne skips the pre-save hook
 * that normally maintains it.
 */
const syncTotalItems = async (wishlistId) => {
  const [row] = await Wishlist.aggregate([
    { $match: { _id: wishlistId } },
    { $project: { n: { $size: "$products" } } },
  ]);
  const n = row?.n ?? 0;
  await Wishlist.updateOne({ _id: wishlistId }, { $set: { totalItems: n } });
  return n;
};

/**
 * @function getWishlist
 * @description The saved-products screen: the user's saved products as product
 *   cards, newest save first, paginated.
 * @param {number} [req.query.page=1]
 * @param {number} [req.query.limit=20] - Max 50
 */
const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await Wishlist.findOne({ user: req.user._id }).lean();
  const { data, pagination } = await savedProductsPage(wishlist, req.query);
  await markViewerState(req.user._id, data);

  res.json({
    success: true,
    data,
    pagination,
    wishlist: {
      _id: wishlist?._id || null,
      name: wishlist?.name || "My Wishlist",
      isPublic: Boolean(wishlist?.isPublic),
      totalItems: pagination.total,
    },
  });
});

/**
 * @function checkProductInWishlist
 * @description Check if a specific product is in user's wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.productId - Product ID to check
 * @returns {Object} - Boolean indicating if product is in wishlist
 */
const checkProductInWishlist = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const userId = req.user._id;

  // Validate product ID
  validateMongodbId(productId);

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  const isInWishlist = wishlist ? wishlist.hasProduct(productId) : false;

  res.json({
    success: true,
    message: "Product wishlist status retrieved",
    data: {
      productId: productId,
      isInWishlist: isInWishlist
    }
  });
});

/**
 * @function clearWishlist
 * @description Clear all products from user's wishlist
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Success message
 */
const clearWishlist = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    ThrowError("Wishlist not found");
  }

  // Clear all products
  wishlist.products = [];
  await wishlist.save();

  res.json({
    success: true,
    message: "Wishlist cleared successfully",
    data: {
      wishlist: {
        _id: wishlist._id,
        products: [],
        totalItems: 0
      }
    }
  });
});

/**
 * @function updateWishlistSettings
 * @description Update wishlist settings (name, privacy)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} [req.body.name] - New wishlist name
 * @param {boolean} [req.body.isPublic] - Privacy setting
 * @returns {Object} - Updated wishlist settings
 */
const updateWishlistSettings = asyncHandler(async (req, res) => {
  const { name, isPublic } = req.body;
  const userId = req.user._id;

  // Get user's wishlist
  const wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    ThrowError("Wishlist not found");
  }

  // Update settings
  if (name !== undefined) {
    wishlist.name = name;
  }
  if (isPublic !== undefined) {
    wishlist.isPublic = isPublic;
  }

  await wishlist.save();

  res.json({
    success: true,
    message: "Wishlist settings updated successfully",
    data: {
      wishlist: {
        _id: wishlist._id,
        name: wishlist.name,
        isPublic: wishlist.isPublic,
        totalItems: wishlist.totalItems
      }
    }
  });
});

/**
 * @function getPublicWishlist
 * @description Get a public wishlist by user ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.userId - User ID whose wishlist to view
 * @returns {Object} - Public wishlist data
 */
const getPublicWishlist = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  validateMongodbId(userId);

  const wishlist = await Wishlist.findOne({ user: userId, isPublic: true }).lean();
  if (!wishlist) {
    ThrowError("Public wishlist not found or user has not made their wishlist public");
  }

  const { data, pagination } = await savedProductsPage(wishlist, req.query);
  // The heart and cart button reflect whoever is looking, not the list's owner.
  await markViewerState(req.user?._id, data);

  res.json({
    success: true,
    message: "Public wishlist retrieved successfully",
    data,
    pagination,
    wishlist: { _id: wishlist._id, name: wishlist.name, totalItems: pagination.total },
  });
});

module.exports = {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  checkProductInWishlist,
  clearWishlist,
  updateWishlistSettings,
  getPublicWishlist
};
