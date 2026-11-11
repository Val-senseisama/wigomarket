/**
 * Product shapes for list and card views.
 *
 * The seller's product list renders one card per product showing image, title,
 * SKU, price, variant count, stock, units sold, a status pill and a rating.
 * Rather than let each caller re-derive those from the raw document, every
 * listing endpoint returns this one shape.
 */

// Stored visibility (productModel.status) vs. what the card pill shows.
// "out_of_stock" is derived, never stored — see the model comment.
const DISPLAY_STATUS = {
  ACTIVE: "active",
  OUT_OF_STOCK: "out_of_stock",
  HIDDEN: "hidden",
};

const STATUS_LABELS = {
  [DISPLAY_STATUS.ACTIVE]: "Active",
  [DISPLAY_STATUS.OUT_OF_STOCK]: "Out of stock",
  [DISPLAY_STATUS.HIDDEN]: "Hidden",
};

// "Available for: Delivery & Pick-up" on the detail screen.
const FULFILMENT_LABELS = {
  delivery: "Delivery",
  pickup: "Pick-up",
};

/**
 * Human label for the availableFor list, in a fixed order so "Delivery &
 * Pick-up" never renders as "Pick-up & Delivery".
 */
const availableForLabel = (availableFor) => {
  const set = new Set(Array.isArray(availableFor) ? availableFor : []);
  const parts = ["delivery", "pickup"]
    .filter((k) => set.has(k))
    .map((k) => FULFILMENT_LABELS[k]);
  return parts.length ? parts.join(" & ") : null;
};

/**
 * The status pill a product card should render.
 * Hidden wins over stock: a hidden product is off the storefront regardless of
 * how many units are left.
 *
 * @param {Object} product - Product document (lean or hydrated)
 * @returns {"active"|"out_of_stock"|"hidden"}
 */
const displayStatusFor = (product) => {
  if (product?.status === "hidden") return DISPLAY_STATUS.HIDDEN;
  return (product?.quantity ?? 0) <= 0
    ? DISPLAY_STATUS.OUT_OF_STOCK
    : DISPLAY_STATUS.ACTIVE;
};

const money = require("./money");

/**
 * The buyer-facing price block: what the card renders.
 *
 *   listedPrice           what the buyer pays — the main price on the card
 *   listedCompareAtPrice  the slashed "was" price, or null for no discount
 *   discountPercent       "-15%" badge, whole percent, or null
 *
 * A stored compare-at that is not above the current listed price (stale data)
 * is treated as no discount rather than showing a slashed price that is lower.
 *
 * @param {Object} doc - Product or variant with listedPrice / price /
 *   listedCompareAtPrice.
 */
const buyerPricing = (doc) => {
  const listedPrice = doc?.listedPrice ?? doc?.price ?? 0;
  const was = doc?.listedCompareAtPrice;
  if (typeof was !== "number" || !money.gt(was, listedPrice)) {
    return { listedPrice, listedCompareAtPrice: null, discountPercent: null };
  }
  const saving = money.subtract(was, listedPrice);
  return {
    listedPrice,
    listedCompareAtPrice: was,
    discountPercent: Math.max(1, Math.round((saving / was) * 100)),
  };
};

/**
 * Seller-side figures: the price the seller set, before the platform margin.
 * Only the product's owner sees these — buyers get listedPrice alone.
 */
const sellerPricing = (doc) => ({
  price: doc?.price ?? 0,
  compareAtPrice: doc?.compareAtPrice ?? null,
});

/** images[0] is the display image; entries may be plain URLs or Cloudinary objects. */
const firstImage = (images) => {
  const img = Array.isArray(images) ? images[0] : null;
  if (!img) return null;
  return typeof img === "string" ? img : img.url || img.secure_url || null;
};

/** A populated ref serializes to { id, ... }; an unpopulated one to its id. */
const refId = (ref) =>
  ref && typeof ref === "object" && ref._id ? ref._id : ref || null;

const serializeCategory = (category) => {
  if (!category) return null;
  if (typeof category !== "object" || !category._id) return { id: category, name: null };

  // `parent` is an id on the listing endpoints and a populated document on the
  // detail endpoint, where the breadcrumb needs its name.
  const parent = category.parent;
  const parentPopulated = parent && typeof parent === "object" && parent._id;

  return {
    id: category._id,
    name: category.name || null,
    parent: refId(parent),
    ...(parentPopulated && {
      parentCategory: { id: parent._id, name: parent.name || null },
    }),
    // "Fashion > Men's Clothing" — the breadcrumb under Product Category.
    path: [parentPopulated ? parent.name : null, category.name]
      .filter(Boolean)
      .join(" > ") || null,
  };
};

const serializeStore = (store) => {
  if (!store || typeof store !== "object" || !store._id) {
    return store ? { id: store, name: null } : null;
  }
  return {
    id: store._id,
    name: store.name || null,
    image: store.image || null,
    address: store.address || null,
    mobile: store.mobile || null,
  };
};

const serializeVariant = (variant, { forOwner = false } = {}) => ({
  id: variant._id,
  sku: variant.sku || null,
  ...buyerPricing(variant),
  ...(forOwner && sellerPricing(variant)),
  stock: variant.quantity ?? 0,
  sold: variant.sold ?? 0,
  image: variant.image || null,
  // [{ name: "Size", value: "41" }] — the combination this variant is for.
  options: variant.options || [],
  inStock: (variant.quantity ?? 0) > 0,
});

/**
 * Cheapest / dearest variant price, for the "from ₦X" figure on variable
 * products. Returns nulls for a single product, whose one price is `price`.
 */
const priceRangeFor = (variants) => {
  if (!Array.isArray(variants) || variants.length === 0) return null;
  const prices = variants
    .map((v) => v.listedPrice ?? v.price)
    .filter((p) => typeof p === "number");
  if (!prices.length) return null;
  return { from: Math.min(...prices), to: Math.max(...prices) };
};

/**
 * Flatten a product into the list/card shape.
 *
 * @param {Object} product - Product document. `store` and `category` should be
 *   populated for the card to show names rather than bare ids.
 * @param {Object} [options]
 * @param {boolean} [options.includeVariants=false] - Embed the full variant
 *   list. Off by default so a 50-product storefront page stays small; the
 *   seller's own listing turns it on.
 * @param {boolean} [options.forOwner=false] - Include the seller-side `price`
 *   and `compareAtPrice` (before the platform margin). Only for the product's
 *   own shop — buyers see listedPrice / listedCompareAtPrice only.
 * @returns {Object}
 */
const serializeProductCard = (product, { includeVariants = false, forOwner = false } = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const displayStatus = displayStatusFor(product);

  return {
    id: product._id,
    title: product.title,
    slug: product.slug || null,
    // The "SKU: #WM1201" line. Null for products created before SKUs existed.
    sku: product.sku || null,
    description: product.description || null,
    brand: product.brand || null,

    // Money. `listedPrice` is what the buyer pays (seller's price + platform
    // margin) and is the figure to render on the card; `listedCompareAtPrice`
    // is the slashed "was" price (null = no discount). The seller's own
    // `price`/`compareAtPrice` are added for the owner only.
    ...buyerPricing(product),
    ...(forOwner && sellerPricing(product)),
    currency: "NGN",

    image: firstImage(product.images),
    images: product.images || [],
    video: product.video || null,

    // Stock & sales. For a variable product both are totals across variants.
    stock: product.quantity ?? 0,
    sold: product.sold ?? 0,
    views: product.views ?? 0,

    // "Variant: 6" on the card — 0 renders as "None".
    productType: product.productType || "single",
    variantCount: variants.length,
    optionTypes: product.optionTypes || [],
    priceRange: priceRangeFor(variants),
    ...(includeVariants && { variants: variants.map((v) => serializeVariant(v, { forOwner })) }),

    // Stored visibility vs. the pill to render. Filter chips use displayStatus;
    // the hide/unhide toggle writes `status`.
    status: product.status || "active",
    displayStatus,
    statusLabel: STATUS_LABELS[displayStatus],

    // How the buyer can receive it — "Delivery", "Pick-up" or both.
    availableFor: product.availableFor || [],
    availableForLabel: availableForLabel(product.availableFor),

    rating: {
      average: product.rating?.average ?? 0,
      count: product.rating?.count ?? 0,
    },

    category: serializeCategory(product.category),
    store: serializeStore(product.store),

    specifications: product.specifications || [],
    sizes: product.sizes || [],
    colors: product.colors || [],
    tags: product.tags || [],
    isFeatured: Boolean(product.isFeatured),

    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};

const serializeProductCards = (products, options) =>
  (products || []).map((p) => serializeProductCard(p, options));

/**
 * The buyer's product card — what the storefront card renders, and nothing
 * more. One shape for every buyer listing: get-products (storefront),
 * home suggested-products, category suggestions, search and saved products.
 * Tapping a card opens GET /api/product/{id} for the full detail.
 *
 * `isInWishlist`, `isInCart` and `cartQuantity` default to false/0 here and
 * are set per viewer by utils/viewerProductState.markViewerState.
 *
 * @param {Object} product - Lean product (or aggregate row) with `store`
 *   populated as { _id, name }. Needs images (or image), listedPrice,
 *   listedCompareAtPrice, quantity, productType, rating and, for the
 *   "from ₦X" range, variants[].listedPrice.
 * @param {Object} [options]
 * @param {boolean} [options.includeVariants=false] - Embed buyer-side variants.
 */
const serializeBuyerCard = (product, { includeVariants = false } = {}) => {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const stock = product.quantity ?? 0;
  const store = product.store && typeof product.store === "object" && product.store._id
    ? { id: product.store._id, name: product.store.name || null }
    : product.store
      ? { id: product.store, name: null }
      : null;

  return {
    id: product._id,
    title: product.title,
    image: firstImage(product.images) ?? product.image ?? null,

    // listedPrice is the price; listedCompareAtPrice the slashed "was" price.
    ...buyerPricing(product),
    currency: "NGN",
    // "from ₦X" for a product with versions; null for a single product.
    priceRange: priceRangeFor(variants),

    // A product with versions needs a choice (size, colour) before it can go
    // in the cart — open the product page instead of adding from the card.
    productType: product.productType || "single",
    hasVariants: (product.productType || "single") === "variable",
    ...(includeVariants && {
      variants: variants.map((v) => serializeVariant(v)),
    }),

    inStock: stock > 0,
    stock,

    rating: {
      average: Math.round((product.rating?.average ?? 0) * 10) / 10,
      count: product.rating?.count ?? 0,
    },
    store,

    isInWishlist: false,
    isInCart: false,
    cartQuantity: 0,
  };
};

const serializeBuyerCards = (products, options) =>
  (products || []).map((p) => serializeBuyerCard(p, options));

/**
 * Projection carrying exactly what serializeBuyerCard reads, for aggregation
 * pipelines that build cards. Add the store lookup ({ _id, name }) separately.
 */
const BUYER_CARD_PROJECTION = {
  _id: 1,
  title: 1,
  images: { $slice: ["$images", 1] },
  listedPrice: 1,
  price: 1, // fallback only, for products saved before listedPrice existed
  listedCompareAtPrice: 1,
  quantity: 1,
  productType: 1,
  "variants.listedPrice": 1,
  "variants.price": 1,
  rating: 1,
  store: 1,
};

/**
 * Full product detail — everything the seller's product page renders, grouped
 * the way the screen is laid out.
 *
 * The flat card fields are kept at the top level so a client already reading a
 * listing response can reuse the same parsing; the grouped blocks
 * (`overview`, `media`, `inventory`, `reviews`) are the panels of the page.
 *
 * @param {Object} product - Product document. `store` and `category` should be
 *   populated, and `category.parent` populated too for the breadcrumb.
 * @param {Object} [extra]
 * @param {Date|string|null} [extra.lastOrderedAt] - When this product was last
 *   ordered. Requires an Order lookup, so the caller supplies it.
 * @param {Object} [extra.reviews] - { average, count, breakdown } for the
 *   Rating & Reviews panel.
 * @param {boolean} [extra.forOwner=false] - Include seller-side prices.
 * @returns {Object}
 */
const serializeProductDetail = (
  product,
  { lastOrderedAt = null, reviews = null, forOwner = false } = {},
) => {
  const card = serializeProductCard(product, { includeVariants: true, forOwner });
  const variants = card.variants || [];

  // Stock arithmetic. `quantity` is what is left on the shelf, `sold` is what
  // has gone out, so the original stock is the sum of the two. On a variable
  // product both top-level figures are already the totals across variants.
  const availableStock = card.stock;
  const totalSold = card.sold;

  return {
    ...card,

    // ── Product Overview panel ──────────────────────────────────────────────
    overview: {
      name: card.title,
      category: card.category,
      categoryPath: card.category?.path || card.category?.name || null,
      sku: card.sku,
      dateAdded: card.createdAt,
      variantCount: card.variantCount,
      availableFor: card.availableFor,
      availableForLabel: card.availableForLabel,
      status: card.status,
      displayStatus: card.displayStatus,
      statusLabel: card.statusLabel,
      productType: card.productType,
      brand: card.brand,
    },

    // ── Media: every picture and the video, in upload order ─────────────────
    media: {
      image: card.image,
      images: card.images,
      video: card.video,
      imageCount: card.images.length,
      hasVideo: Boolean(card.video),
    },

    // ── Pricing & Inventory panel ───────────────────────────────────────────
    inventory: {
      ...(forOwner && { price: card.price, compareAtPrice: card.compareAtPrice }),
      listedPrice: card.listedPrice,
      listedCompareAtPrice: card.listedCompareAtPrice,
      discountPercent: card.discountPercent,
      currency: card.currency,
      priceRange: card.priceRange,
      // Stock ever listed = what is left + what has been sold.
      totalStock: availableStock + totalSold,
      availableStock,
      totalSold,
      lastOrderedAt: lastOrderedAt || null,
      // The variants table. Empty for a single-version product, whose one row
      // is the top-level price/stock above.
      variants,
    },

    // ── Rating & Reviews panel ──────────────────────────────────────────────
    reviews: reviews || {
      average: card.rating.average,
      count: card.rating.count,
      breakdown: null,
    },
  };
};

module.exports = {
  DISPLAY_STATUS,
  STATUS_LABELS,
  FULFILMENT_LABELS,
  availableForLabel,
  buyerPricing,
  displayStatusFor,
  serializeProductCard,
  serializeProductCards,
  serializeBuyerCard,
  serializeBuyerCards,
  BUYER_CARD_PROJECTION,
  serializeProductDetail,
};
