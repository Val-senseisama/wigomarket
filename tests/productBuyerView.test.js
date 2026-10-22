jest.mock("../config/redisClient", () => ({
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue("OK"),
  del: jest.fn().mockResolvedValue(1),
  incr: jest.fn().mockResolvedValue(1),
  disconnect: jest.fn(),
}));

const request = require("supertest");
const app = require("../app");
const Store = require("../models/storeModel");
const Order = require("../models/orderModel");
const Wishlist = require("../models/wishlistModel");
const ProductReview = require("../models/productReviewModel");
const { createTestUser, createTestSeller, createTestProduct } = require("./helpers");

let seq = 0;
const product = (storeId, overrides) =>
  createTestProduct(storeId, { title: `Buyer ${++seq}`, slug: `buyer-${Date.now()}-${seq}`, ...overrides });

const shop = async () => {
  const seller = await createTestSeller();
  await Store.updateOne({ _id: seller.store._id }, { status: "active" });
  return seller;
};

const deliveredOrder = (buyerId, p) =>
  Order.create({
    orderedBy: buyerId,
    products: [{ product: p._id, count: 1, price: 1000, store: p.store }],
    paymentIntent: { method: "card", amount: 1000, status: "success" },
    deliveryAddress: "1 Test Street, Lagos",
    deliveryMethod: "delivery_agent",
    orderStatus: "delivered",
    totalAmount: 1000,
  });

describe("GET /api/product/:id buyer view", () => {
  it("guests get the video, the shop rating and an empty viewer block", async () => {
    const { store } = await shop();
    const p = await product(store._id, {
      video: "https://res.cloudinary.com/demo/video/upload/v1/products/demo.mp4",
      rating: { average: 4, count: 3 },
    });

    const res = await request(app).get(`/api/product/${p._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.video).toMatch(/demo\.mp4$/);
    expect(res.body.data.media.hasVideo).toBe(true);
    expect(res.body.data.store.rating).toEqual({ average: 4, count: 3 });
    expect(res.body.data.viewer).toEqual({
      isSignedIn: false,
      isInWishlist: false,
      canReview: false,
      myReview: null,
    });
  });

  it("a signed-in buyer sees wishlist state and review eligibility", async () => {
    const { store } = await shop();
    const p = await product(store._id);
    const { user, token } = await createTestUser();
    const auth = { Authorization: `Bearer ${token}` };

    let res = await request(app).get(`/api/product/${p._id}`).set(auth);
    expect(res.body.data.viewer).toMatchObject({ isSignedIn: true, isInWishlist: false, canReview: false });

    await Wishlist.create({ user: user._id, products: [{ product: p._id }] });
    const order = await deliveredOrder(user._id, p);
    await ProductReview.create({ product: p._id, user: user._id, order: order._id, rating: 5, comment: "Great" });

    res = await request(app).get(`/api/product/${p._id}`).set(auth);
    expect(res.body.data.viewer.isInWishlist).toBe(true);
    expect(res.body.data.viewer.canReview).toBe(true);
    expect(res.body.data.viewer.myReview).toMatchObject({ rating: 5, comment: "Great" });
  });

  it("the owner never gets canReview", async () => {
    const { store, token } = await shop();
    const p = await product(store._id);
    const res = await request(app).get(`/api/product/${p._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.isOwner).toBe(true);
    expect(res.body.data.viewer.canReview).toBe(false);
  });
});

describe("GET /api/product/get-products isInWishlist", () => {
  it("marks the caller's saved products and is false for guests", async () => {
    const { store } = await shop();
    const saved = await product(store._id);
    const other = await product(store._id);
    const { user, token } = await createTestUser();
    await Wishlist.create({ user: user._id, products: [{ product: saved._id }] });

    const res = await request(app)
      .get(`/api/product/get-products?store=${store._id}`)
      .set("Authorization", `Bearer ${token}`);
    const flags = Object.fromEntries(res.body.data.map((p) => [String(p.id), p.isInWishlist]));
    expect(flags).toEqual({ [String(saved._id)]: true, [String(other._id)]: false });

    const guest = await request(app).get(`/api/product/get-products?store=${store._id}`);
    expect(guest.body.data.every((p) => p.isInWishlist === false)).toBe(true);
  });
});
