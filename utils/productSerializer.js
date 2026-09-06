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

const serializeVariant = (variant) => ({
  id: variant._id,
  sku: variant.sku || null,
  price: variant.price,
  listedPrice: variant.listedPrice ?? null,
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
 * @returns {Object}
 */
const serializeProductCard = (product, { includeVariants = false } = {}) => {
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

    // Money. `price` is what the seller set; `listedPrice` is what the buyer
    // pays (price + platform margin) and is the figure to render on the card.
    price: product.price ?? 0,
    listedPrice: product.listedPrice ?? product.price ?? 0,
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
    ...(includeVariants && { variants: variants.map(serializeVariant) }),

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
 * @returns {Object}
 */
const serializeProductDetail = (product, { lastOrderedAt = null, reviews = null } = {}) => {
  const card = serializeProductCard(product, { includeVariants: true });
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
      price: card.price,
      listedPrice: card.listedPrice,
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
  displayStatusFor,
  serializeProductCard,
  serializeProductCards,
  serializeProductDetail,
};
