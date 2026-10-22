const mockRedisStore = new Map();
jest.mock("../config/redisClient", () => ({
  get: jest.fn(async (k) => mockRedisStore.get(k) ?? null),
  setex: jest.fn(async (k, _ttl, v) => mockRedisStore.set(k, v)),
  incr: jest.fn(async (k) => {
    const n = Number(mockRedisStore.get(k) || 0) + 1;
    mockRedisStore.set(k, String(n));
    return n;
  }),
  disconnect: jest.fn(),
}));

const request = require("supertest");
const app = require("../app");
const Category = require("../models/categoryModel");
const Store = require("../models/storeModel");
const { createTestUser, createTestSeller, createTestProduct } = require("./helpers");

const cloud = process.env.CLOUDINARY_CLOUD_NAME || "demo";
const imageUrl = (name) => `https://res.cloudinary.com/${cloud}/image/upload/v1/categories/${name}.jpg`;

const adminAuth = async () => {
  const { token } = await createTestUser({ role: ["admin"], activeRole: "admin" });
  return { Authorization: `Bearer ${token}` };
};

beforeEach(() => mockRedisStore.clear());

describe("Category images", () => {
  it("update-category sets, rejects a foreign URL, and clears with null", async () => {
    const auth = await adminAuth();
    const category = await Category.create({ name: `Phones ${Date.now()}` });
    const put = (body) =>
      request(app).put("/api/product/update-category").set(auth).send({ id: category._id, ...body });

    const ok = await put({ image: imageUrl("phones") });
    expect(ok.status).toBe(200);
    expect(ok.body.data.image).toBe(imageUrl("phones"));

    const bad = await put({ image: "https://evil.example.com/x.jpg" });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/folder: categories/);
    expect((await Category.findById(category._id)).image).toBe(imageUrl("phones"));

    const cleared = await put({ image: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.image).toBeNull();
  });

  it("create-category rejects a non-Cloudinary image", async () => {
    const auth = await adminAuth();
    const res = await request(app)
      .post("/api/product/create-category")
      .set(auth)
      .send({ name: `Bad ${Date.now()}`, image: "not-a-url" });
    expect(res.status).toBe(400);
  });

  it("the home categories section shows a new image straight away", async () => {
    const auth = await adminAuth();
    const category = await Category.create({ name: `Cakes ${Date.now()}` });
    const { store } = await createTestSeller();
    await Store.updateOne({ _id: store._id }, { status: "active" });
    await createTestProduct(store._id, { category: category._id, slug: `cake-${Date.now()}`, listedPrice: 5100 });

    const find = (res) => res.body.data.find((c) => String(c._id) === String(category._id));
    const before = await request(app).get("/api/home/categories");
    expect(find(before).image).toBeNull();

    await request(app).put("/api/product/update-category").set(auth).send({ id: category._id, image: imageUrl("cakes") });

    const after = await request(app).get("/api/home/categories");
    expect(find(after).image).toBe(imageUrl("cakes"));
  });
});
