jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const Store = require("../models/storeModel");
const { createTestUser, createTestSeller, createTestProduct, setupCart } = require("./helpers");
const { isOpenNow, parseOpeningHours } = require("../utils/storeSettings");

const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe("PUT /api/store/my-store", () => {
  it("updates only the fields sent", async () => {
    const { token, store } = await createTestSeller();
    const res = await request(app)
      .put("/api/store/my-store")
      .set(auth(token))
      .send({ description: "Fresh groceries", city: "Yaba" });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe("Fresh groceries");
    expect(res.body.data.city).toBe("Yaba");
    expect(res.body.data.name).toBe(store.name);
  });

  it("rejects an empty body, a taken name and non-sellers", async () => {
    const { store: other } = await createTestSeller();
    const { token } = await createTestSeller();

    expect((await request(app).put("/api/store/my-store").set(auth(token)).send({})).status).toBe(400);

    const taken = await request(app)
      .put("/api/store/my-store")
      .set(auth(token))
      .send({ name: other.name.toUpperCase() });
    expect(taken.status).toBe(400);

    const { token: buyerToken } = await createTestUser();
    expect(
      (await request(app).put("/api/store/my-store").set(auth(buyerToken)).send({ city: "x" })).status,
    ).toBe(403);
  });

  it("ignores fields that have their own flows", async () => {
    const { token, store } = await createTestSeller();
    await request(app)
      .put("/api/store/my-store")
      .set(auth(token))
      .send({ city: "Yaba", ownerNIN: "hacked", balance: 1e9, status: "active" });

    const fresh = await Store.findById(store._id).lean();
    expect(fresh.ownerNIN).toBe(store.ownerNIN);
    expect(fresh.balance).toBe(0);
    expect(fresh.status).toBe("pending");
  });
});

describe("GET/PUT /api/store/settings", () => {
  it("returns defaults before anything is saved", async () => {
    const { token } = await createTestSeller();
    const res = await request(app).get("/api/store/settings").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      isVisible: true,
      openingHours: null,
      isOpenNow: null,
      fulfilmentOptions: ["delivery", "pickup"],
    });
  });

  it("saves a partial update and leaves the rest alone", async () => {
    const { token } = await createTestSeller();
    await request(app)
      .put("/api/store/settings")
      .set(auth(token))
      .send({ fulfilmentOptions: ["pickup"] });

    const res = await request(app)
      .put("/api/store/settings")
      .set(auth(token))
      .send({
        openingHours: {
          days: [
            { day: "Sunday", isOpen: false },
            { day: "monday", open: "09:00", close: "18:00" },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.fulfilmentOptions).toEqual(["pickup"]);
    expect(res.body.data.openingHours).toEqual({
      timezone: "Africa/Lagos",
      days: [
        { day: "monday", isOpen: true, open: "09:00", close: "18:00" },
        { day: "sunday", isOpen: false },
      ],
    });
    expect(typeof res.body.data.isOpenNow).toBe("boolean");

    const cleared = await request(app)
      .put("/api/store/settings")
      .set(auth(token))
      .send({ openingHours: null });
    expect(cleared.body.data.openingHours).toBeNull();
  });

  it.each([
    [{}, /at least one/],
    [{ isVisible: "no" }, /isVisible/],
    [{ fulfilmentOptions: [] }, /fulfilmentOptions/],
    [{ fulfilmentOptions: ["teleport"] }, /teleport/],
    [{ openingHours: { days: [{ day: "funday", open: "09:00", close: "17:00" }] } }, /funday/],
    [{ openingHours: { days: [{ day: "monday", open: "9am", close: "17:00" }] } }, /HH:mm/],
    [{ openingHours: { days: [{ day: "monday", open: "09:00", close: "09:00" }] } }, /differ/],
    [{ openingHours: { timezone: "Mars/Base", days: [] } }, /timezone/],
    [
      {
        openingHours: {
          days: [
            { day: "monday", isOpen: false },
            { day: "monday", isOpen: false },
          ],
        },
      },
      /more than once/,
    ],
  ])("rejects %j", async (body, message) => {
    const { token } = await createTestSeller();
    const res = await request(app).put("/api/store/settings").set(auth(token)).send(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(message);
  });
});

describe("isOpenNow", () => {
  // 2026-10-12 is a Monday. Lagos is UTC+1 all year.
  const at = (isoUtc) => new Date(isoUtc);
  const hours = (days) => parseOpeningHours({ days }).value;

  it("is null without hours", () => {
    expect(isOpenNow(undefined)).toBeNull();
    expect(isOpenNow({ days: [] })).toBeNull();
  });

  it("follows the shop's timezone", () => {
    const h = hours([{ day: "monday", open: "09:00", close: "18:00" }]);
    expect(isOpenNow(h, at("2026-10-12T07:59:00Z"))).toBe(false); // 08:59 Lagos
    expect(isOpenNow(h, at("2026-10-12T08:00:00Z"))).toBe(true); // 09:00 Lagos
    expect(isOpenNow(h, at("2026-10-12T17:00:00Z"))).toBe(false); // 18:00 Lagos, closed
    expect(isOpenNow(h, at("2026-10-13T10:00:00Z"))).toBe(false); // Tuesday not listed
  });

  it("handles hours that run past midnight", () => {
    const h = hours([{ day: "friday", open: "18:00", close: "02:00" }]);
    expect(isOpenNow(h, at("2026-10-16T22:00:00Z"))).toBe(true); // Fri 23:00
    expect(isOpenNow(h, at("2026-10-17T00:30:00Z"))).toBe(true); // Sat 01:30
    expect(isOpenNow(h, at("2026-10-17T01:30:00Z"))).toBe(false); // Sat 02:30
  });
});

describe("Shop visibility", () => {
  const hide = (token) =>
    request(app).put("/api/store/settings").set(auth(token)).send({ isVisible: false });

  it("hides the shop page and its products from buyers but not from the owner", async () => {
    const { token, store } = await createTestSeller();
    const product = await createTestProduct(store._id);

    expect((await request(app).get(`/api/store/${store._id}`)).status).toBe(200);
    expect((await hide(token)).status).toBe(200);

    expect((await request(app).get(`/api/store/${store._id}`)).status).toBe(404);
    expect((await request(app).get(`/api/product/${product._id}`)).status).toBe(404);

    const listing = await request(app).get("/api/product/get-products");
    expect(listing.body.data.map((p) => String(p._id))).not.toContain(String(product._id));

    const storefront = await request(app).get(`/api/product/get-products?store=${store._id}`);
    expect(storefront.body.data).toHaveLength(0);

    const all = await request(app).get("/api/store/all");
    expect(all.body.map((s) => String(s._id))).not.toContain(String(store._id));

    // The owner still sees their product and shop.
    const own = await request(app).get(`/api/product/${product._id}`).set(auth(token));
    expect(own.status).toBe(200);
    const mine = await request(app).get("/api/product/get-products?mine=true").set(auth(token));
    expect(mine.body.data).toHaveLength(1);
    expect((await request(app).get("/api/store/my-store").set(auth(token))).body.isVisible).toBe(false);

    // Showing it again restores everything.
    await request(app).put("/api/store/settings").set(auth(token)).send({ isVisible: true });
    expect((await request(app).get(`/api/product/${product._id}`)).status).toBe(200);
  });

  it("never exposes owner-only fields on the public store page", async () => {
    const { store } = await createTestSeller();
    const res = await request(app).get(`/api/store/${store._id}`);
    expect(res.status).toBe(200);
    for (const field of ["ownerNIN", "bankDetails", "subAccountDetails", "balance"]) {
      expect(res.body).not.toHaveProperty(field);
    }
    expect(res.body.fulfilmentOptions).toEqual(["delivery", "pickup"]);
  });
});

describe("Checkout honours shop preferences", () => {
  const checkout = (token, deliveryMethod) =>
    request(app).post("/api/order/create").set(auth(token)).send({
      paymentMethod: "card",
      deliveryMethod,
      deliveryAddress: "123 Test Street, Lagos",
    });

  const cartWith = async (fulfilmentOptions, isVisible = true) => {
    const { store } = await createTestSeller();
    await Store.updateOne({ _id: store._id }, { $set: { fulfilmentOptions, isVisible } });
    const product = await createTestProduct(store._id);
    const { user, token } = await createTestUser();
    await setupCart(user._id, product._id, store._id);
    return token;
  };

  it("refuses a method the shop does not offer", async () => {
    const token = await cartWith(["delivery"]);
    const res = await checkout(token, "self_delivery");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not offer pickup/);
  });

  it("accepts a method the shop offers", async () => {
    const token = await cartWith(["pickup"]);
    const res = await checkout(token, "self_delivery");
    expect(res.status).toBeLessThan(300);
  });

  it("refuses items from a hidden shop", async () => {
    const token = await cartWith(["delivery", "pickup"], false);
    const res = await checkout(token, "self_delivery");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not taking orders/);
  });
});
