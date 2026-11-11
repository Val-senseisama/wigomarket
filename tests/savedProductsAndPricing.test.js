/**
 * Buyer card contract: one price block (listedPrice + slashed
 * listedCompareAtPrice), one saved flag (isInWishlist) shared by every product
 * listing and the detail page, and paginated home "view all" feeds.
 */
jest.mock("../config/redisClient", () => ({
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue("OK"),
  del: jest.fn().mockResolvedValue(1),
  incr: jest.fn().mockResolvedValue(1),
  lPush: jest.fn().mockResolvedValue(1),
  lTrim: jest.fn().mockResolvedValue("OK"),
  disconnect: jest.fn(),
}));

const request = require("supertest");
const app = require("../app");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Wishlist = require("../models/wishlistModel");
const { createTestUser, createTestSeller, createTestProduct } = require("./helpers");
const { createProduct, updateProduct } = require("../controllers/productController");
const { parseCompareAtPrice, validateVariants } = require("../utils/productVariants");
const { buyerPricing } = require("../utils/productSerializer");

let seq = 0;
const product = (storeId, overrides) =>
  createTestProduct(storeId, { title: `Card ${++seq}`, slug: `card-${Date.now()}-${seq}`, ...overrides });

const shop = async (extra = {}) => {
  const seller = await createTestSeller();
  await Store.updateOne({ _id: seller.store._id }, { status: "active", ...extra });
  return seller;
};

const call = async (handler, req) => {
  const res = { statusCode: 200 };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  let thrown;
  await handler({ body: {}, query: {}, params: {}, ...req }, res, (e) => { thrown = e; });
  if (thrown) throw thrown;
  return res;
};

describe("compare-at (slashed) price", () => {
  it("validates against the seller's price", () => {
    expect(parseCompareAtPrice(undefined, 1000)).toEqual({ provided: false });
    expect(parseCompareAtPrice(null, 1000)).toMatchObject({ provided: true, compareAtPrice: null });
    expect(parseCompareAtPrice(1000, 1000).error).toMatch(/higher than price/);
    expect(parseCompareAtPrice(1200, 1000)).toMatchObject({ compareAtPrice: 1200, listedCompareAtPrice: 1224 });
  });

  it("derives a variable product's slashed price from its cheapest variant", () => {
    const { derived, errors } = validateVariants({
      optionTypes: [{ name: "Size", values: ["M", "L"] }],
      variants: [
        { price: 5000, compareAtPrice: 6000, quantity: 1, options: [{ name: "Size", value: "M" }] },
        { price: 7000, compareAtPrice: 9000, quantity: 1, options: [{ name: "Size", value: "L" }] },
      ],
    });
    expect(errors).toEqual([]);
    expect(derived).toMatchObject({ price: 5000, compareAtPrice: 6000, listedPrice: 5100, listedCompareAtPrice: 6120 });
  });

  it("buyerPricing gives the badge and ignores a stale compare-at", () => {
    expect(buyerPricing({ listedPrice: 8500, listedCompareAtPrice: 10000 })).toEqual({
      listedPrice: 8500, listedCompareAtPrice: 10000, discountPercent: 15,
    });
    expect(buyerPricing({ listedPrice: 8500, listedCompareAtPrice: 8000 }).listedCompareAtPrice).toBeNull();
  });

  it("create stores it; update rejects a price raised above it", async () => {
    const { user, store } = await shop();
    const category = (await product(store._id)).category;
    const created = await call(createProduct, {
      store: store._id,
      user: { _id: user._id },
      body: {
        title: "Discounted kettle", description: "Boils", price: 8000, compareAtPrice: 10000, quantity: 3,
        category: String(category), images: [`https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME || "demo"}/image/upload/v1/products/main.jpg`],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.body.data._id;
    const saved = await Product.findById(id).lean();
    expect(saved).toMatchObject({ compareAtPrice: 10000, listedCompareAtPrice: 10200, listedPrice: 8160 });

    const tooHigh = await call(updateProduct, { store: store._id, params: { id: String(id) }, body: { price: 11000 } });
    expect(tooHigh.statusCode).toBe(400);

    const cleared = await call(updateProduct, {
      store: store._id, params: { id: String(id) }, body: { price: 11000, compareAtPrice: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.body.data).toMatchObject({ price: 11000, compareAtPrice: null, listedCompareAtPrice: null });
  });

  it("public cards carry the slashed price but never the seller's price; the owner gets both", async () => {
    const { store, token } = await shop();
    await product(store._id, { price: 8000, listedPrice: 8160, compareAtPrice: 10000, listedCompareAtPrice: 10200 });

    const pub = await request(app).get(`/api/product/get-products?store=${store._id}`);
    const card = pub.body.data[0];
    expect(card).toMatchObject({ listedPrice: 8160, listedCompareAtPrice: 10200, discountPercent: 20 });
    expect(card.price).toBeUndefined();
    expect(card.compareAtPrice).toBeUndefined();

    const mine = await request(app).get("/api/product/get-products?mine=true").set("Authorization", `Bearer ${token}`);
    expect(mine.body.data[0]).toMatchObject({ price: 8000, compareAtPrice: 10000, listedPrice: 8160 });
  });
});

describe("saved products (heart) stay in sync", () => {
  it("save and unsave are idempotent and reflected on every listing and the detail page", async () => {
    const { store } = await shop();
    const p = await product(store._id, { sold: 1e6, listedPrice: 5100 });
    const { token } = await createTestUser();
    const auth = (r) => r.set("Authorization", `Bearer ${token}`);

    for (let i = 0; i < 2; i++) {
      const add = await auth(request(app).post("/api/wishlist/add")).send({ productId: String(p._id) });
      expect(add.status).toBe(200);
      expect(add.body.data).toEqual({ productId: String(p._id), isInWishlist: true, totalItems: 1 });
    }

    const detail = await auth(request(app).get(`/api/product/${p._id}`));
    expect(detail.body.data.isInWishlist).toBe(true);
    expect(detail.body.data.viewer.isInWishlist).toBe(true);

    const list = await auth(request(app).get(`/api/product/get-products?store=${store._id}`));
    expect(list.body.data[0].isInWishlist).toBe(true);

    const suggested = await auth(request(app).get("/api/home/suggested-products?limit=50"));
    expect(suggested.status).toBe(200);
    const s = suggested.body.data.find((x) => String(x.id) === String(p._id));
    expect(s).toMatchObject({ isInWishlist: true, listedPrice: 5100, listedCompareAtPrice: null });
    expect(s.price).toBeUndefined();
    const guest = await request(app).get("/api/home/suggested-products?limit=50");
    expect(guest.body.data.find((x) => String(x.id) === String(p._id)).isInWishlist).toBe(false);

    const savedScreen = await auth(request(app).get("/api/wishlist"));
    expect(savedScreen.body.data).toHaveLength(1);
    expect(savedScreen.body.data[0]).toMatchObject({ id: String(p._id), isInWishlist: true, listedPrice: 5100 });
    expect(savedScreen.body.data[0].price).toBeUndefined();
    expect(savedScreen.body.pagination).toMatchObject({ total: 1, page: 1, hasMore: false });

    for (let i = 0; i < 2; i++) {
      const rm = await auth(request(app).delete(`/api/wishlist/remove/${p._id}`));
      expect(rm.status).toBe(200);
      expect(rm.body.data).toMatchObject({ isInWishlist: false, totalItems: 0 });
    }
    const after = await auth(request(app).get(`/api/product/${p._id}`));
    expect(after.body.data.isInWishlist).toBe(false);
  });

  it("the saved screen leaves out hidden products and pages newest-first", async () => {
    const { store } = await shop();
    const a = await product(store._id);
    const b = await product(store._id);
    const hidden = await product(store._id, { status: "hidden" });
    const { user, token } = await createTestUser();
    await Wishlist.create({
      user: user._id,
      products: [
        { product: a._id, addedAt: new Date("2026-01-01") },
        { product: b._id, addedAt: new Date("2026-02-01") },
        { product: hidden._id, addedAt: new Date("2026-03-01") },
      ],
    });

    const p1 = await request(app).get("/api/wishlist?limit=1").set("Authorization", `Bearer ${token}`);
    expect(p1.body.data.map((c) => c.id)).toEqual([String(b._id)]);
    expect(p1.body.pagination).toMatchObject({ total: 2, hasMore: true });
    const p2 = await request(app).get("/api/wishlist?limit=1&page=2").set("Authorization", `Bearer ${token}`);
    expect(p2.body.data.map((c) => c.id)).toEqual([String(a._id)]);
    expect(p2.body.pagination.hasMore).toBe(false);
  });

  it("cannot save a hidden product", async () => {
    const { store } = await shop();
    const hidden = await product(store._id, { status: "hidden" });
    const { token } = await createTestUser();
    const res = await request(app)
      .post("/api/wishlist/add")
      .set("Authorization", `Bearer ${token}`)
      .send({ productId: String(hidden._id) });
    expect(res.status).toBe(404);
  });
});

describe("home view-all pagination", () => {
  // Far from every other test's shops, so the nearby result set is ours alone.
  const HERE = { lat: 4.05, lng: 9.7 };

  it("nearby-shops pages with hasMore", async () => {
    for (let i = 0; i < 3; i++) {
      await shop({
        location: { type: "Point", coordinates: [HERE.lng + i * 0.001, HERE.lat] },
      });
    }
    const url = (page) => `/api/home/nearby-shops?lat=${HERE.lat}&lng=${HERE.lng}&limit=2&page=${page}`;
    const p1 = await request(app).get(url(1));
    expect(p1.status).toBe(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.pagination).toEqual({ page: 1, limit: 2, hasMore: true });
    const p2 = await request(app).get(url(2));
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.pagination.hasMore).toBe(false);
    const ids = [...p1.body.data, ...p2.body.data].map((s) => String(s._id));
    expect(new Set(ids).size).toBe(3);
  });

  it("popular-vendors and suggested-products page without overlap", async () => {
    await shop();
    await shop();
    const v1 = await request(app).get("/api/home/popular-vendors?limit=1&page=1");
    const v2 = await request(app).get("/api/home/popular-vendors?limit=1&page=2");
    expect(v1.body.pagination).toMatchObject({ page: 1, limit: 1, hasMore: true });
    expect(String(v1.body.data[0]._id)).not.toBe(String(v2.body.data[0]._id));

    const { store } = await shop();
    await product(store._id);
    await product(store._id);
    const s1 = await request(app).get("/api/home/suggested-products?limit=1&page=1");
    const s2 = await request(app).get("/api/home/suggested-products?limit=1&page=2");
    expect(s1.body.pagination).toMatchObject({ page: 1, limit: 1, hasMore: true });
    expect(s1.body.pagination.total).toBeGreaterThanOrEqual(2);
    expect(String(s1.body.data[0].id)).not.toBe(String(s2.body.data[0].id));
  });
});
