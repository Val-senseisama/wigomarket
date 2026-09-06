const Product = require("../models/productModel");
const Category = require("../models/categoryModel");
const { serializeProductCards } = require("../utils/productSerializer");

/**
 * Shared query builder for product listings — the seller's "Product List" grid
 * and the public storefront both run through here, differing only in whether
 * hidden products are in scope.
 */

// Escape a user-supplied search term so "C++ (2024)" is matched literally
// instead of being compiled as a regular expression.
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The seller searches by product name or SKU — the two things printed on the
// card. Description and brand are deliberately excluded: they match far too
// broadly to be useful in a list of your own products.
const searchFilter = (search) => {
  const term = String(search || "").trim();
  if (!term) return {};
  const rx = { $regex: escapeRegex(term.replace(/^#/, "")), $options: "i" };
  return { $or: [{ title: rx }, { sku: rx }] };
};

/**
 * Status the UI filters on, mapped to a query fragment.
 *
 *   active       — on the shelf and in stock
 *   out_of_stock — on the shelf, nothing left
 *   hidden       — taken off the shelf by the seller (owner-only)
 *   all          — no status constraint
 */
const STATUS_FILTERS = {
  active: { status: "active", quantity: { $gt: 0 } },
  out_of_stock: { status: { $ne: "hidden" }, quantity: { $lte: 0 } },
  hidden: { status: "hidden" },
  all: {},
};

const STATUS_VALUES = Object.keys(STATUS_FILTERS);

// Accepts the canonical tokens plus the spellings a UI is likely to send
// ("Out of stock", "outOfStock", "in_stock").
const normalizeStatus = (status) => {
  if (status === undefined || status === null || status === "") return null;
  const value = String(status).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "instock" || value === "in_stock") return "active";
  if (value === "outofstock") return "out_of_stock";
  return STATUS_VALUES.includes(value) ? value : null;
};

const statusFilter = (status) => STATUS_FILTERS[status] || {};

const priceFilter = (minPrice, maxPrice) => {
  const range = {};
  const min = parseFloat(minPrice);
  const max = parseFloat(maxPrice);
  if (!isNaN(min)) range.$gte = min;
  if (!isNaN(max)) range.$lte = max;
  return Object.keys(range).length ? { listedPrice: range } : {};
};

const SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  price_asc: { listedPrice: 1 },
  price_desc: { listedPrice: -1 },
  best_selling: { sold: -1 },
  top_rated: { "rating.average": -1, "rating.count": -1 },
  title_asc: { title: 1 },
  title_desc: { title: -1 },
  stock_asc: { quantity: 1 },
  stock_desc: { quantity: -1 },
};

const buildSort = (sort) => SORTS[String(sort || "").toLowerCase()] || SORTS.newest;

/**
 * Category filter. Picking a top-level category in the filter dropdown includes
 * its subcategories — a seller filtering on "Fashion" expects the products they
 * filed under "Men's Clothing" to show up.
 */
const categoryFilter = async (category) => {
  if (!category) return {};
  const children = await Category.find({ parent: category }, "_id").lean();
  return children.length
    ? { category: { $in: [category, ...children.map((c) => c._id)] } }
    : { category };
};

const merge = (...fragments) => {
  const parts = fragments.filter((f) => f && Object.keys(f).length);
  return parts.length ? { $and: parts } : {};
};

/**
 * List products for a grid.
 *
 * @param {Object} opts
 * @param {Object} [opts.baseFilter={}] Scope applied to every query and to the
 *   status counts — e.g. `{ store }` for a seller's own list.
 * @param {Object} opts.query Raw req.query: search, category, store, brand,
 *   minPrice, maxPrice, status, sort, page, limit.
 * @param {boolean} [opts.includeHidden=false] Whether hidden products are in
 *   scope. False for every public caller.
 * @param {boolean} [opts.includeVariants=false] Embed full variant lists.
 * @param {boolean} [opts.withCounts=false] Also return per-status totals for
 *   the filter chips. Skipped on unscoped public listings — four extra counts
 *   across the whole catalogue is not worth it.
 * @returns {Promise<{products: Object[], pagination: Object, counts: Object|null}>}
 */
const listProducts = async ({
  baseFilter = {},
  query = {},
  includeHidden = false,
  includeVariants = false,
  withCounts = false,
} = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
  const skip = (page - 1) * limit;

  // A public caller never sees hidden products, whatever they ask for.
  const visibility = includeHidden ? {} : { status: { $ne: "hidden" } };

  // No explicit status: the seller's own list shows everything, while the
  // storefront keeps its long-standing "in stock only" default.
  const requested = normalizeStatus(query.status);
  const status = requested || (includeHidden ? "all" : "active");

  const scope = merge(baseFilter, visibility);
  const filter = merge(
    scope,
    statusFilter(status),
    searchFilter(query.search),
    await categoryFilter(query.category),
    query.brand ? { brand: { $regex: escapeRegex(query.brand), $options: "i" } } : {},
    priceFilter(query.minPrice, query.maxPrice),
  );

  const countIn = (fragment) => Product.countDocuments(merge(scope, fragment));

  const [products, total, counts] = await Promise.all([
    Product.find(filter)
      .populate("store", "name image address mobile")
      .populate("category", "name parent")
      .sort(buildSort(query.sort))
      .skip(skip)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
    withCounts
      ? Promise.all([
          countIn({}),
          countIn(STATUS_FILTERS.active),
          countIn(STATUS_FILTERS.out_of_stock),
          includeHidden ? countIn(STATUS_FILTERS.hidden) : Promise.resolve(0),
        ]).then(([all, active, outOfStock, hidden]) => ({
          all,
          active,
          out_of_stock: outOfStock,
          hidden,
        }))
      : Promise.resolve(null),
  ]);

  return {
    products: serializeProductCards(products, { includeVariants }),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 0,
      hasMore: skip + products.length < total,
    },
    counts,
    // Echoed so the client can render the active filter state without
    // re-deriving the defaults applied here.
    appliedStatus: status,
  };
};

module.exports = { listProducts, STATUS_VALUES, normalizeStatus };
