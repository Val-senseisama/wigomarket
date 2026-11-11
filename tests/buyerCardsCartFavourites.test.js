/**
 * One buyer product card everywhere; cart state on it; favourite vendors;
 * home category sorting; a shop's category filter.
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
const Category = require("../models/categoryModel");
const Wishlist = require("../models/wishlistModel");
const { createTestUser, createTestSeller, createTestProduct } = require("./helpers");

let seq = 0;
const uniq = () => `${Date.now()}${++seq}`;
const product = (storeId, overrides) =>
  createTestProduct(storeId, { title: `Cardy ${uniq()}`, slug: `cardy-${uniq()}`, listedPrice: 5100, ...overrides });
const shop = async (extra = {}) => {
  const seller = await createTestSeller();
  await Store.updateOne({ _id: seller.store._id }, { status: "active", ...extra });
  return seller;
};
const authed = (token) => ({
  get: (url) => request(app).get(url).set("Authorization", `Bearer ${token}`),
  post: (url) => request(app).post(url).set("Authorization", `Bearer ${token}`),
  put: (url) => request(app).put(url).set("Authorization", `Bearer ${token}`),
  del: (url) => request(app).delete(url).set("Authorization", `Bearer ${token}`),
});

const CARD_KEYS = [
  "cartQuantity", "currency", "discountPercent", "hasVariants", "id", "image", "inStock",
  "isInCart", "isInWishlist", "listedCompareAtPrice", "listedPrice", "priceRange",
  "productType", "rating", "stock", "store", "title",
].sort();

describe("one buyer product card", () => {
  it("get-products, suggested, category suggestions, search, saved and cart share it", async () => {
    const category = await Category.create({ name: `Watches ${uniq()}` });
    const { store } = await shop();
    const title = `Quartz ${uniq()}`;
    const p = await product(store._id, {
      title, category: category._id, sold: 1e7,
      listedCompareAtPrice: 6000, compareAtPrice: 5900,
      images: ["https://res.cloudinary.com/demo/image/upload/v1/products/w.jpg"],
    });
    const { user, token } = await createTestUser();
    const as = authed(token);
    await Wishlist.create({ user: user._id, products: [{ product: p._id }] });
    await as.post("/api/user/add-cart").send({ productId: String(p._id), count: 2 }).expect(200);

    const pick = (arr) => arr.find((c) => String(c.id) === String(p._id));
    const cards = {
      list: pick((await as.get(`/api/product/get-products?store=${store._id}`)).body.data),
      suggested: pick((await as.get("/api/home/suggested-products?limit=50")).body.data),
      category: pick((await as.get(`/api/product/products/suggestions/category/${category._id}`)).body.data),
      search: pick((await as.get(`/api/search?q=${encodeURIComponent(title)}`)).body.data.products),
      saved: pick((await as.get("/api/wishlist")).body.data),
      cart: (await as.get("/api/user/get-cart")).body.data.items[0].product,
    };

    for (const [name, card] of Object.entries(cards)) {
      expect({ name, keys: Object.keys(card).filter((k) => !["searchScore", "savedAt"].includes(k)).sort() })
        .toEqual({ name, keys: CARD_KEYS });
      expect({ name, ...card }).toMatchObject({
        name,
        listedPrice: 5100,
        listedCompareAtPrice: 6000,
        isInWishlist: true,
        isInCart: true,
        cartQuantity: 2,
        image: "https://res.cloudinary.com/demo/image/upload/v1/products/w.jpg",
        store: { id: String(store._id) },
      });
    }

    const detail = (await as.get(`/api/product/${p._id}`)).body.data;
    expect(detail).toMatchObject({ isInWishlist: true, isInCart: true, cartQuantity: 2 });
  });

  it("category suggestions page and include subcategories", async () => {
    const parent = await Category.create({ name: `Fashion ${uniq()}` });
    const child = await Category.create({ name: `Shirts ${uniq()}`, parent: parent._id });
    const { store } = await shop();
    await product(store._id, { category: parent._id });
    await product(store._id, { category: child._id });
    await product(store._id, { category: child._id, status: "hidden" });

    const res = await request(app).get(`/api/product/products/suggestions/category/${parent._id}?limit=1`);
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ id: String(parent._id), name: parent.name });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ total: 2, hasMore: true });
  });
});

describe("cart", () => {
  it("adds, caps at stock, ignores a client store, flags rather than drops unbuyable lines", async () => {
    const { store } = await shop();
    const { store: other } = await shop();
    const p = await product(store._id, { quantity: 3 });
    const { token } = await createTestUser();
    const as = authed(token);

    // Legacy body with a lying store.
    let res = await as.post("/api/user/add-cart").send({ product: { _id: String(p._id), count: 2, store: { _id: String(other._id) } } });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ itemCount: 2, cartTotal: 10200, hasUnavailableItems: false });
    expect(res.body.data.items[0]).toMatchObject({ count: 2, unitPrice: 5100, lineTotal: 10200, store: { id: String(store._id) } });

    res = await as.post("/api/user/add-cart").send({ productId: String(p._id), count: 2 });
    expect(res.status).toBe(400);

    res = await as.put("/api/user/update-cart").send({ productId: String(p._id), newCount: 3 });
    expect(res.body.data.cartTotal).toBe(15300);

    // Seller reprices and stock runs out: the line stays, flagged, out of the total.
    await Product.updateOne({ _id: p._id }, { listedPrice: 6000, quantity: 0 });
    res = await as.get("/api/user/get-cart");
    expect(res.body.data.items[0]).toMatchObject({ available: false, issue: "out_of_stock", unitPrice: 6000 });
    expect(res.body.data).toMatchObject({ cartTotal: 0, itemCount: 0, lineCount: 1, hasUnavailableItems: true });

    for (let i = 0; i < 2; i++) {
      res = await as.del(`/api/user/cart/${p._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    }
  });

  it("will not add hidden products and prunes deleted ones", async () => {
    const { store } = await shop();
    const hidden = await product(store._id, { status: "hidden" });
    const gone = await product(store._id);
    const { token } = await createTestUser();
    const as = authed(token);

    expect((await as.post("/api/user/add-cart").send({ productId: String(hidden._id) })).status).toBe(404);
    await as.post("/api/user/add-cart").send({ productId: String(gone._id) }).expect(200);
    await Product.deleteOne({ _id: gone._id });
    const res = await as.get("/api/user/get-cart");
    expect(res.body.data.items).toHaveLength(0);
  });
});

describe("favourite vendors", () => {
  it("save is idempotent and shows on vendor cards, store detail and the favourites list", async () => {
    const { store } = await shop({ location: { type: "Point", coordinates: [3.38, 6.52] } });
    await product(store._id, { rating: { average: 4, count: 2 } });
    const { token } = await createTestUser();
    const as = authed(token);

    for (let i = 0; i < 2; i++) {
      const res = await as.put(`/api/favourites/stores/${store._id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ storeId: String(store._id), isFavourite: true, totalItems: 1 });
    }

    const find = (data) => data.find((s) => String(s._id) === String(store._id));
    expect(find((await as.get("/api/home/popular-vendors?limit=50")).body.data).isFavourite).toBe(true);
    expect(find((await as.get("/api/home/top-shops?limit=20")).body.data)?.isFavourite ?? true).toBe(true);
    expect(find((await request(app).get("/api/home/popular-vendors?limit=50")).body.data).isFavourite).toBe(false);
    expect((await as.get(`/api/store/${store._id}`)).body.isFavourite).toBe(true);

    const list = await as.get("/api/favourites/stores?lat=6.52&lng=3.38");
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      _id: String(store._id), isFavourite: true, rating: { average: 4, count: 2 }, distanceKm: 0,
    });
    expect(list.body.pagination).toMatchObject({ total: 1, hasMore: false });

    await Store.updateOne({ _id: store._id }, { isVisible: false });
    expect((await as.get("/api/favourites/stores")).body.data).toHaveLength(0);
    await Store.updateOne({ _id: store._id }, { isVisible: true });

    for (let i = 0; i < 2; i++) {
      const res = await as.del(`/api/favourites/stores/${store._id}`);
      expect(res.body.data).toMatchObject({ isFavourite: false, totalItems: 0 });
    }
    expect((await as.get(`/api/store/${store._id}`)).body.isFavourite).toBe(false);
  });
});

describe("home categories sort", () => {
  it("sorts by price, name and latest; ignores hidden products", async () => {
    const tag = uniq();
    const { store } = await shop();
    const a = await Category.create({ name: `a-cat ${tag}` });
    const b = await Category.create({ name: `B-cat ${tag}` });
    await product(store._id, { category: a._id, listedPrice: 100, createdAt: new Date("2026-01-01") });
    await product(store._id, { category: b._id, listedPrice: 900 });
    await product(store._id, { category: a._id, listedPrice: 1, status: "hidden" });

    const order = async (sort) => {
      const res = await request(app).get(`/api/home/categories?limit=24&sort=${sort}`);
      expect(res.status).toBe(200);
      return res.body.data.filter((c) => c.name.endsWith(tag)).map((c) => c.name.split(" ")[0]);
    };
    expect(await order("highest_price")).toEqual(["B-cat", "a-cat"]);
    expect(await order("lowest_price")).toEqual(["a-cat", "B-cat"]);
    expect(await order("alphabetical")).toEqual(["a-cat", "B-cat"]);
    expect(await order("latest")).toEqual(["B-cat", "a-cat"]);

    const res = await request(app).get("/api/home/categories?limit=24&sort=lowest_price");
    expect(res.body.data.find((c) => String(c._id) === String(a._id)).fromPrice).toBe(100);
  });
});

describe("a shop's category filter", () => {
  it("lists the shop's categories with counts", async () => {
    const { store } = await shop();
    const c1 = await Category.create({ name: `Food ${uniq()}` });
    const c2 = await Category.create({ name: `Gadgets ${uniq()}` });
    await product(store._id, { category: c1._id });
    await product(store._id, { category: c1._id });
    await product(store._id, { category: c2._id, quantity: 0 });

    const res = await request(app).get(`/api/store/${store._id}/categories`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: String(c1._id), name: c1.name, image: null, productCount: 2 }]);

    const filtered = await request(app).get(`/api/product/get-products?store=${store._id}&category=${c1._id}`);
    expect(filtered.body.data).toHaveLength(2);
  });
});
