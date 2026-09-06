/**
 * Seller product-management tests — the product detail screen and the controls
 * on it: delete, bulk hide/delete, editing (including the variants table), and
 * the Rating & Reviews panel.
 *
 * Controllers are called directly with a stub req/res, as in
 * productListing.test.js. `req.store` is what isSeller sets.
 */

const {
  getAProduct,
  updateProduct,
  deleteProduct,
  bulkUpdateProducts,
  getProductReviews,
  getAllProducts,
} = require("../controllers/productController");
const Product = require("../models/productModel");
const ProductReview = require("../models/productReviewModel");
const Store = require("../models/storeModel");
const User = require("../models/userModel");
const Category = require("../models/categoryModel");
const Cart = require("../models/cartModel");
const Wishlist = require("../models/wishlistModel");
const Order = require("../models/orderModel");

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

const call = async (handler, req) => {
  const res = makeRes();
  let thrown;
  await handler({ body: {}, query: {}, params: {}, ...req }, res, (err) => {
    thrown = err;
  });
  if (thrown) throw thrown;
  return res;
};

let seq = 0;
const uniq = () => `${Date.now()}${++seq}`;

const makeSeller = async () => {
  const n = uniq();
  const user = await User.create({
    fullName: "Detail Seller",
    email: `seller-${n}@example.com`,
    mobile: `2348${n.slice(-8)}`,
    password: "TestPass123!",
    role: ["seller"],
    activeRole: "seller",
    status: "active",
  });
  const store = await Store.create({
    name: `Detail Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    email: `store-${n}@example.com`,
    owner: user._id,
    address: "1 Test Street",
    ownerNIN: n.slice(-11),
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
  return { user, store };
};

const makeCategory = (overrides = {}) =>
  Category.create({ name: `Category ${uniq()}`, ...overrides });

const IMAGE = "https://res.cloudinary.com/demo/image/upload/v1/products/main.jpg";
const IMAGE_2 = "https://res.cloudinary.com/demo/image/upload/v1/products/side.jpg";
const VIDEO = "https://res.cloudinary.com/demo/video/upload/v1/products/demo.mp4";

const makeProduct = (store, category, overrides = {}) =>
  Product.create({
    title: "Men's Casual Short Sleeve Shirt",
    slug: `shirt-${uniq()}`,
    description: "Breathable cotton shirt.",
    price: 7500,
    listedPrice: 7650,
    quantity: 8,
    sold: 12,
    category: category._id,
    store: store._id,
    images: [IMAGE],
    ...overrides,
  });

const asSeller = (user, store, req) => ({ user, store: store._id, ...req });

// ── Product detail ─────────────────────────────────────────────────────────

describe("getAProduct — full detail", () => {
  it("returns the overview, media, inventory and review panels", async () => {
    const { user, store } = await makeSeller();
    const parent = await makeCategory();
    const category = await makeCategory({ parent: parent._id });
    const product = await makeProduct(store, category, {
      sku: "SHRT-MNS-CAS-SS-NAVY-L",
      images: [IMAGE, IMAGE_2],
      video: VIDEO,
      availableFor: ["delivery", "pickup"],
      rating: { average: 4.5, count: 10 },
    });

    const res = await call(getAProduct, { params: { id: String(product._id) } });
    const data = res.body.data;

    expect(res.body.success).toBe(true);

    // Overview panel
    expect(data.overview.name).toBe("Men's Casual Short Sleeve Shirt");
    expect(data.overview.sku).toBe("SHRT-MNS-CAS-SS-NAVY-L");
    expect(data.overview.categoryPath).toBe(`${parent.name} > ${category.name}`);
    expect(data.overview.availableForLabel).toBe("Delivery & Pick-up");
    expect(data.overview.statusLabel).toBe("Active");
    expect(data.overview.dateAdded).toBeTruthy();

    // Every picture and the video
    expect(data.media.images).toEqual([IMAGE, IMAGE_2]);
    expect(data.media.imageCount).toBe(2);
    expect(data.media.video).toBe(VIDEO);
    expect(data.media.hasVideo).toBe(true);

    // Description
    expect(data.description).toBe("Breathable cotton shirt.");

    // Pricing & inventory — total stock is what is left plus what has sold
    expect(data.inventory.availableStock).toBe(8);
    expect(data.inventory.totalSold).toBe(12);
    expect(data.inventory.totalStock).toBe(20);
    expect(data.inventory.variants).toEqual([]);

    // Rating & reviews
    expect(data.reviews).toEqual({
      average: 4.5,
      count: 10,
      breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    });
  });

  it("returns the variants table for a multiple-version product", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category, {
      productType: "variable",
      quantity: 8,
      optionTypes: [{ name: "Size", values: ["M", "L"] }],
      variants: [
        { sku: "S-M", price: 7500, listedPrice: 7650, quantity: 2, sold: 10, options: [{ name: "Size", value: "M" }] },
        { sku: "S-L", price: 8000, listedPrice: 8160, quantity: 6, sold: 2, options: [{ name: "Size", value: "L" }] },
      ],
    });

    const res = await call(getAProduct, { params: { id: String(product._id) } });
    const { inventory } = res.body.data;

    expect(inventory.variants).toHaveLength(2);
    expect(inventory.variants[0]).toMatchObject({ sku: "S-M", price: 7500, stock: 2, sold: 10, inStock: true });
    expect(inventory.priceRange).toEqual({ from: 7650, to: 8160 });
    expect(res.body.data.variantCount).toBe(2);
  });

  it("gives the owner isOwner and lastOrderedAt, and hides both from buyers", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const buyer = await User.create({
      fullName: "Buyer",
      email: `buyer-${uniq()}@example.com`,
      mobile: `2349${uniq().slice(-8)}`,
      password: "TestPass123!",
      status: "active",
    });
    await Order.create({
      orderedBy: buyer._id,
      products: [{ product: product._id, count: 1, price: 7650 }],
      paymentIntent: { method: "wallet", amount: 7650, status: "success" },
      deliveryAddress: "1 Test Street, Lagos",
      deliveryMethod: "delivery_agent",
      orderStatus: "delivered",
      totalAmount: 7650,
    });

    const owner = await call(getAProduct, { params: { id: String(product._id) }, user });
    expect(owner.body.isOwner).toBe(true);
    expect(owner.body.data.inventory.lastOrderedAt).toBeTruthy();

    const anon = await call(getAProduct, { params: { id: String(product._id) } });
    expect(anon.body.isOwner).toBe(false);
    expect(anon.body.data.inventory.lastOrderedAt).toBeNull();
  });
});

// ── Delete ─────────────────────────────────────────────────────────────────

describe("deleteProduct", () => {
  it("deletes the product and cleans up reviews, carts and wishlists", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);
    const other = await makeProduct(store, category, { title: "Untouched" });

    const buyer = await User.create({
      fullName: "Buyer",
      email: `buyer-${uniq()}@example.com`,
      mobile: `2349${uniq().slice(-8)}`,
      password: "TestPass123!",
      status: "active",
    });
    const order = await Order.create({
      orderedBy: buyer._id,
      products: [{ product: product._id, count: 1, price: 7650 }],
      paymentIntent: { method: "wallet", amount: 7650, status: "success" },
      deliveryAddress: "1 Test Street, Lagos",
      deliveryMethod: "delivery_agent",
      orderStatus: "delivered",
      totalAmount: 7650,
    });
    await ProductReview.create({
      product: product._id, user: buyer._id, order: order._id, rating: 5, comment: "Great",
    });
    await Cart.create({
      owner: buyer._id,
      products: [
        { product: product._id, count: 1, price: 7650, store: store._id },
        { product: other._id, count: 1, price: 7650, store: store._id },
      ],
    });
    await Wishlist.create({ user: buyer._id, products: [{ product: product._id }] });

    const res = await call(
      deleteProduct,
      asSeller(user, store, { params: { id: String(product._id) } }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(await Product.findById(product._id)).toBeNull();
    expect(await ProductReview.countDocuments({ product: product._id })).toBe(0);

    const cart = await Cart.findOne({ owner: buyer._id }).lean();
    expect(cart.products).toHaveLength(1);
    expect(String(cart.products[0].product)).toBe(String(other._id));

    const wishlist = await Wishlist.findOne({ user: buyer._id }).lean();
    expect(wishlist.products).toHaveLength(0);
  });

  it("will not delete another store's product, and deletes nothing at all", async () => {
    const mine = await makeSeller();
    const theirs = await makeSeller();
    const category = await makeCategory();
    const own = await makeProduct(mine.store, category);
    const foreign = await makeProduct(theirs.store, category);

    const res = await call(
      deleteProduct,
      asSeller(mine.user, mine.store, { params: { id: String(foreign._id) } }),
    );

    expect(res.statusCode).toBe(404);
    expect(await Product.findById(foreign._id)).not.toBeNull();
    // The old implementation passed a bare id as the filter, which deletes an
    // arbitrary document. Nothing of the caller's may disappear either.
    expect(await Product.findById(own._id)).not.toBeNull();
  });
});

// ── Bulk actions ───────────────────────────────────────────────────────────

describe("bulkUpdateProducts", () => {
  it("hides and unhides several products at once", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const a = await makeProduct(store, category);
    const b = await makeProduct(store, category);

    const hidden = await call(
      bulkUpdateProducts,
      asSeller(user, store, { body: { action: "hide", ids: [String(a._id), String(b._id)] } }),
    );
    expect(hidden.body.data).toMatchObject({ action: "hide", matched: 2, affected: 2, skipped: [] });
    expect((await Product.findById(a._id)).status).toBe("hidden");
    expect((await Product.findById(b._id)).status).toBe("hidden");

    await call(
      bulkUpdateProducts,
      asSeller(user, store, { body: { action: "unhide", ids: [String(a._id), String(b._id)] } }),
    );
    expect((await Product.findById(a._id)).status).toBe("active");
  });

  it("deletes several products and reports foreign ids as skipped", async () => {
    const mine = await makeSeller();
    const theirs = await makeSeller();
    const category = await makeCategory();
    const own = await makeProduct(mine.store, category);
    const foreign = await makeProduct(theirs.store, category);

    const res = await call(
      bulkUpdateProducts,
      asSeller(mine.user, mine.store, {
        body: { action: "delete", ids: [String(own._id), String(foreign._id)] },
      }),
    );

    expect(res.body.data.matched).toBe(1);
    expect(res.body.data.affected).toBe(1);
    expect(res.body.data.skipped).toEqual([String(foreign._id)]);
    expect(await Product.findById(own._id)).toBeNull();
    expect(await Product.findById(foreign._id)).not.toBeNull();
  });

  it("rejects an unknown action, an empty list and a malformed id", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const bad = await call(
      bulkUpdateProducts,
      asSeller(user, store, { body: { action: "archive", ids: [String(product._id)] } }),
    );
    expect(bad.statusCode).toBe(400);

    const empty = await call(
      bulkUpdateProducts,
      asSeller(user, store, { body: { action: "hide", ids: [] } }),
    );
    expect(empty.statusCode).toBe(400);

    const malformed = await call(
      bulkUpdateProducts,
      asSeller(user, store, { body: { action: "hide", ids: ["not-an-id"] } }),
    );
    expect(malformed.statusCode).toBe(400);
  });

  it("404s when none of the ids are in the caller's store", async () => {
    const mine = await makeSeller();
    const theirs = await makeSeller();
    const category = await makeCategory();
    const foreign = await makeProduct(theirs.store, category);

    const res = await call(
      bulkUpdateProducts,
      asSeller(mine.user, mine.store, { body: { action: "delete", ids: [String(foreign._id)] } }),
    );

    expect(res.statusCode).toBe(404);
    expect(await Product.findById(foreign._id)).not.toBeNull();
  });
});

// ── Editing ────────────────────────────────────────────────────────────────

describe("updateProduct — the edit screen", () => {
  it("edits the fields the product page shows and returns the detail shape", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const res = await call(
      updateProduct,
      asSeller(user, store, {
        params: { id: String(product._id) },
        body: {
          title: "Men's Linen Shirt",
          description: "Linen, not cotton.",
          price: 9000,
          quantity: 12,
          sku: "LINEN-01",
          images: [IMAGE, IMAGE_2],
          video: VIDEO,
          availableFor: ["delivery", "pickup"],
        },
      }),
    );

    expect(res.statusCode).toBe(200);
    const data = res.body.data;
    expect(data.title).toBe("Men's Linen Shirt");
    expect(data.sku).toBe("LINEN-01");
    expect(data.media.images).toHaveLength(2);
    expect(data.media.video).toBe(VIDEO);
    expect(data.overview.availableForLabel).toBe("Delivery & Pick-up");
    // listedPrice is re-derived, never taken from the client
    expect(data.price).toBe(9000);
    expect(data.listedPrice).toBe(9180);
    expect(data.inventory.availableStock).toBe(12);
  });

  it("edits variants, re-derives the parent price and stock, and keeps sold", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category, {
      productType: "variable",
      quantity: 8,
      optionTypes: [{ name: "Size", values: ["M", "L"] }],
      variants: [
        { sku: "S-M", price: 7500, listedPrice: 7650, quantity: 2, sold: 10, options: [{ name: "Size", value: "M" }] },
        { sku: "S-L", price: 8000, listedPrice: 8160, quantity: 6, sold: 2, options: [{ name: "Size", value: "L" }] },
      ],
    });

    const res = await call(
      updateProduct,
      asSeller(user, store, {
        params: { id: String(product._id) },
        body: {
          variants: [
            { sku: "S-M", price: 7000, quantity: 5, options: [{ name: "Size", value: "M" }] },
            { sku: "S-L", price: 8000, quantity: 6, options: [{ name: "Size", value: "L" }] },
          ],
        },
      }),
    );

    expect(res.statusCode).toBe(200);
    const { inventory } = res.body.data;
    expect(inventory.price).toBe(7000);          // cheapest variant
    expect(inventory.availableStock).toBe(11);   // 5 + 6
    // sold survives a reprice
    const m = inventory.variants.find((v) => v.sku === "S-M");
    expect(m.sold).toBe(10);
    expect(m.price).toBe(7000);
  });

  it("rejects price or quantity sent directly to a variable product", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category, {
      productType: "variable",
      optionTypes: [{ name: "Size", values: ["M"] }],
      variants: [{ sku: "S-M", price: 7500, listedPrice: 7650, quantity: 2, options: [{ name: "Size", value: "M" }] }],
    });

    const res = await call(
      updateProduct,
      asSeller(user, store, { params: { id: String(product._id) }, body: { price: 100 } }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects variants on a single-version product and a productType change", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const variants = await call(
      updateProduct,
      asSeller(user, store, {
        params: { id: String(product._id) },
        body: { variants: [{ price: 1, quantity: 1, options: [{ name: "Size", value: "M" }] }] },
      }),
    );
    expect(variants.statusCode).toBe(400);

    const retype = await call(
      updateProduct,
      asSeller(user, store, { params: { id: String(product._id) }, body: { productType: "variable" } }),
    );
    expect(retype.statusCode).toBe(400);
  });

  it("keeps SKUs unique within the store and lets a SKU be cleared", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, { sku: "TAKEN" });
    const product = await makeProduct(store, category, { sku: "MINE" });

    const clash = await call(
      updateProduct,
      asSeller(user, store, { params: { id: String(product._id) }, body: { sku: "TAKEN" } }),
    );
    expect(clash.statusCode).toBe(400);

    const cleared = await call(
      updateProduct,
      asSeller(user, store, { params: { id: String(product._id) }, body: { sku: null } }),
    );
    expect(cleared.statusCode).toBe(200);
    expect(cleared.body.data.sku).toBeNull();
  });

  it("rejects a video that is not a Cloudinary URL and accepts null to remove it", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category, { video: VIDEO });

    const bad = await call(
      updateProduct,
      asSeller(user, store, { params: { id: String(product._id) }, body: { video: "https://example.com/x.mp4" } }),
    );
    expect(bad.statusCode).toBe(400);

    const removed = await call(
      updateProduct,
      asSeller(user, store, { params: { id: String(product._id) }, body: { video: null } }),
    );
    expect(removed.body.data.media.video).toBeNull();
  });

  it("rejects an availableFor value that is not delivery or pickup", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const res = await call(
      updateProduct,
      asSeller(user, store, { params: { id: String(product._id) }, body: { availableFor: ["drone"] } }),
    );
    expect(res.statusCode).toBe(400);
  });
});

// ── Category filter ────────────────────────────────────────────────────────

describe("category filter", () => {
  it("includes subcategories when a top-level category is chosen", async () => {
    const { user, store } = await makeSeller();
    const parent = await makeCategory();
    const child = await makeCategory({ parent: parent._id });
    const unrelated = await makeCategory();

    await makeProduct(store, child, { title: "In the subcategory" });
    await makeProduct(store, unrelated, { title: "Elsewhere" });

    const res = await call(getAllProducts, {
      query: { mine: "true", category: String(parent._id) },
      user,
    });

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("In the subcategory");
  });
});

// ── Reviews ────────────────────────────────────────────────────────────────

describe("getProductReviews — the Rating & Reviews panel", () => {
  const makeReviews = async (product, ratings) => {
    for (const rating of ratings) {
      const buyer = await User.create({
        fullName: "Reviewer",
        email: `rev-${uniq()}@example.com`,
        mobile: `2346${uniq().slice(-8)}`,
        password: "TestPass123!",
        status: "active",
      });
      const order = await Order.create({
        orderedBy: buyer._id,
        products: [{ product: product._id, count: 1, price: 7650 }],
        paymentIntent: { method: "wallet", amount: 7650, status: "success" },
      deliveryAddress: "1 Test Street, Lagos",
      deliveryMethod: "delivery_agent",
        orderStatus: "delivered",
        totalAmount: 7650,
      });
      await ProductReview.create({
        product: product._id,
        user: buyer._id,
        order: order._id,
        rating,
        comment: `Rated ${rating}`,
      });
    }
  };

  it("returns the summary, the bars and a page of reviews", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);
    await makeReviews(product, [5, 5, 4, 3, 1]);

    const res = await call(getProductReviews, {
      params: { id: String(product._id) },
      query: { limit: "2" },
    });

    const { summary, reviews, pagination, breakdown } = res.body.data;
    expect(summary.count).toBe(5);
    expect(summary.average).toBeCloseTo(3.6, 1);
    expect(summary.breakdown).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 2 });
    expect(breakdown).toEqual(summary.breakdown);
    expect(reviews).toHaveLength(2);
    expect(pagination).toMatchObject({ currentPage: 1, totalPages: 3, totalResults: 5, hasNext: true, hasPrev: false });
  });

  it("filters to one star rating without collapsing the bars", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);
    await makeReviews(product, [5, 5, 4, 3, 1]);

    const res = await call(getProductReviews, {
      params: { id: String(product._id) },
      query: { rating: "5" },
    });

    expect(res.body.data.reviews).toHaveLength(2);
    expect(res.body.data.reviews.every((r) => r.rating === 5)).toBe(true);
    expect(res.body.data.pagination.totalResults).toBe(2);
    // The bars still describe every review, not just the filtered slice.
    expect(res.body.data.summary.breakdown).toEqual({ 1: 1, 2: 0, 3: 1, 4: 1, 5: 2 });
    expect(res.body.data.appliedFilters).toEqual({ sort: "recent", rating: 5 });
  });

  it("sorts by highest and lowest rating", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);
    await makeReviews(product, [5, 3, 1]);

    const highest = await call(getProductReviews, {
      params: { id: String(product._id) },
      query: { sort: "highest" },
    });
    expect(highest.body.data.reviews[0].rating).toBe(5);

    const lowest = await call(getProductReviews, {
      params: { id: String(product._id) },
      query: { sort: "lowest" },
    });
    expect(lowest.body.data.reviews[0].rating).toBe(1);
  });

  it("rejects a rating filter outside 1-5", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const res = await call(getProductReviews, {
      params: { id: String(product._id) },
      query: { rating: "9" },
    });
    expect(res.statusCode).toBe(400);
  });
});
