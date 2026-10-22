// Keep Redis out: cached cards from an earlier run would mask the query.
jest.mock("../config/redisClient", () => ({
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue("OK"),
  disconnect: jest.fn(),
}));

const request = require("supertest");
const app = require("../app");
const Store = require("../models/storeModel");
const { createTestSeller, createTestProduct } = require("./helpers");

let seq = 0;
const product = (storeId, overrides) =>
  createTestProduct(storeId, { title: `Item ${++seq}`, slug: `item-${Date.now()}-${seq}`, ...overrides });

/**
 * A shop with one rated in-stock product (4★ × 10), one rated out-of-stock
 * product (2★ × 5) and one hidden product (5★ × 100) that must not count.
 */
const ratedShop = async () => {
  const { store } = await createTestSeller();
  await Store.updateOne(
    { _id: store._id },
    { status: "active", description: "Sound systems for campus events." },
  );
  const inStock = await product(store._id, { rating: { average: 4, count: 10 } });
  const soldOut = await product(store._id, { quantity: 0, rating: { average: 2, count: 5 } });
  const hidden = await product(store._id, { status: "hidden", rating: { average: 5, count: 100 } });
  return { store, inStock, soldOut, hidden };
};

describe("Top shop popup data", () => {
  it("top-shops cards carry address and description, and rate from unhidden products only", async () => {
    const { store } = await ratedShop();

    const res = await request(app).get("/api/home/top-shops");
    expect(res.status).toBe(200);
    const card = res.body.data.find((s) => String(s._id) === String(store._id));
    expect(card).toBeDefined();
    expect(card.address).toBe("123 Test Street");
    expect(card.description).toBe("Sound systems for campus events.");
    expect(card.totalProducts).toBe(1);
    expect(card.rating).toEqual({ average: 3.3, count: 15 });
  });

  it("popular-vendors cards match", async () => {
    const { store } = await ratedShop();
    const res = await request(app).get("/api/home/popular-vendors");
    expect(res.status).toBe(200);
    const card = res.body.data.find((s) => String(s._id) === String(store._id));
    expect(card.address).toBe("123 Test Street");
    expect(card.description).toBe("Sound systems for campus events.");
    expect(card.rating).toEqual({ average: 3.3, count: 15 });
  });

  it("GET /api/store/:id reports the same rating as the cards", async () => {
    const { store } = await ratedShop();
    const res = await request(app).get(`/api/store/${store._id}`);
    expect(res.status).toBe(200);
    expect(res.body.rating).toEqual({ average: 3.3, count: 15 });
    expect(res.body.address).toBe("123 Test Street");
    expect(res.body.description).toBe("Sound systems for campus events.");
  });

  it("a shop with no reviews rates 0 from 0", async () => {
    const { store } = await createTestSeller();
    await Store.updateOne({ _id: store._id }, { status: "active" });
    await product(store._id);
    const res = await request(app).get(`/api/store/${store._id}`);
    expect(res.body.rating).toEqual({ average: 0, count: 0 });
  });

  it("View Products lists the shop's unhidden products", async () => {
    const { store, inStock, soldOut, hidden } = await ratedShop();
    const other = await createTestSeller();
    await product(other.store._id);

    const ids = (res) => res.body.data.map((p) => String(p.id));

    const def = await request(app).get(`/api/product/get-products?store=${store._id}`);
    expect(def.status).toBe(200);
    expect(ids(def)).toEqual([String(inStock._id)]);

    const all = await request(app).get(`/api/product/get-products?store=${store._id}&status=all`);
    expect(ids(all).sort()).toEqual([String(inStock._id), String(soldOut._id)].sort());
    expect(ids(all)).not.toContain(String(hidden._id));
  });
});
