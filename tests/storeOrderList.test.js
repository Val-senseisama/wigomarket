/**
 * GET /api/store/orders — the seller order-management table.
 *
 * Covers the three contract points the dashboard depends on:
 *   - every row carries allowedActions, identical to the detail endpoint's;
 *   - `category` values line up with the `counts` keys;
 *   - `status` accepts several values (multi-select) and rejects unknown ones.
 */
jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const { createTestUser } = require("./helpers");

let seq = 0;
const seedStore = (ownerId) => {
  const unique = `${Date.now()}${String(++seq).padStart(4, "0")}`;
  return Store.create({
    name: `Orders Store ${unique}`,
    email: `orders-${unique}@example.com`,
    mobile: `2349${unique.slice(-8)}`,
    businessType: "retail",
    city: "Lagos",
    state: "Lagos",
    ownerNIN: unique.slice(-11),
    address: "12 Test Road, Lagos",
    owner: ownerId,
  });
};

const seedOrder = (storeId, buyerId, orderStatus, deliveryMethod) =>
  Order.create({
    products: [{ product: new mongoose.Types.ObjectId(), count: 1, store: storeId }],
    orderedBy: buyerId,
    deliveryMethod,
    deliveryAddress: "12 Test Road, Lagos",
    orderStatus,
    paymentStatus: "Paid",
    paymentIntent: { amount: 5000, currency: "NGN" },
  });

let token, orders;

const list = (qs = "") =>
  request(app)
    .get(`/api/store/orders?limit=100${qs ? `&${qs}` : ""}`)
    .set("Authorization", `Bearer ${token}`);

const idsOf = (res) => res.body.data.orders.map((o) => o.id).sort();
const idsFor = (...keys) => keys.map((k) => orders[k]._id.toString()).sort();

beforeEach(async () => {
  const { user: seller, token: t } = await createTestUser({
    role: ["seller"],
    activeRole: "seller",
  });
  token = t;
  const store = await seedStore(seller._id);
  const { user: buyer } = await createTestUser();

  const make = (status, method) => seedOrder(store._id, buyer._id, status, method);
  orders = {
    pending: await make("pending", "delivery_agent"),
    confirmed: await make("confirmed", "delivery_agent"),
    readySelf: await make("pickUpReady", "self_delivery"),
    readyRider: await make("pickUpReady", "delivery_agent"),
    delivered: await make("delivered", "self_delivery"),
    cancelled: await make("cancelled", "delivery_agent"),
  };

  // Another seller's order — must never leak into this store's rows or counts.
  const { user: otherSeller } = await createTestUser({ role: ["seller"], activeRole: "seller" });
  const otherStore = await seedStore(otherSeller._id);
  await seedOrder(otherStore._id, buyer._id, "pending", "delivery_agent");
});

describe("allowedActions on list rows", () => {
  it("gives each row the seller's valid next statuses", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const row = (key) =>
      res.body.data.orders.find((o) => o.id === orders[key]._id.toString());
    const next = (key) => row(key).allowedActions.map((a) => a.status);

    expect(next("pending")).toEqual(["confirmed", "cancelled"]);
    expect(next("confirmed")).toEqual(["preparing", "pickUpReady", "cancelled"]);
    // Pickup orders: the seller hands over, so "delivered" is theirs to set.
    expect(next("readySelf")).toEqual(["delivered", "cancelled"]);
    // Rider orders: in transit belongs to the rider, not the seller.
    expect(next("readyRider")).toEqual(["cancelled"]);
    expect(next("delivered")).toEqual([]);
    expect(next("cancelled")).toEqual([]);

    expect(row("pending").allowedActions[0]).toEqual({
      status: "confirmed",
      label: "Confirmed",
    });
  });

  it("matches the detail endpoint's allowedActions exactly", async () => {
    const res = await list();
    for (const row of res.body.data.orders) {
      const detail = await request(app)
        .get(`/api/store/orders/${row.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(detail.status).toBe(200);
      expect(row.allowedActions).toEqual(detail.body.data.allowedActions);
    }
  });
});

describe("category and counts", () => {
  it("returns counts keyed by the category values, scoped to the store", async () => {
    const res = await list();
    expect(res.body.data.counts).toEqual({
      all: 6,
      pending: 1,
      ongoing: 4, // every non-terminal order, pending included
      history: 2,
    });
  });

  it("filters by each category", async () => {
    expect(idsOf(await list("category=all"))).toEqual(idsFor(
      "pending", "confirmed", "readySelf", "readyRider", "delivered", "cancelled",
    ));
    expect(idsOf(await list("category=pending"))).toEqual(idsFor("pending"));
    expect(idsOf(await list("category=ongoing"))).toEqual(
      idsFor("pending", "confirmed", "readySelf", "readyRider"),
    );
    expect(idsOf(await list("category=history"))).toEqual(idsFor("delivered", "cancelled"));
  });

  it("still accepts 'recent' as an alias of 'all'", async () => {
    const res = await list("category=recent");
    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(6);
  });

  it("rejects an unknown category with 400", async () => {
    const res = await list("category=archived");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid category: archived/);
  });
});

describe("multi-value status filter", () => {
  const expected = () => idsFor("pending", "delivered");

  it("accepts a repeated status key", async () => {
    expect(idsOf(await list("status=pending&status=delivered"))).toEqual(expected());
  });

  it("accepts comma-separated statuses", async () => {
    expect(idsOf(await list("status=pending,delivered"))).toEqual(expected());
  });

  it("accepts bracket array syntax", async () => {
    expect(idsOf(await list("status[]=pending&status[]=delivered"))).toEqual(expected());
  });

  it("accepts display labels — and no longer returns pending orders for them", async () => {
    // Regression: "Pick up Ready" used to normalise to "pending".
    const res = await list(`status=${encodeURIComponent("Pick up Ready")}`);
    expect(idsOf(res)).toEqual(idsFor("readySelf", "readyRider"));
  });

  it("combines status with category using AND", async () => {
    const res = await list("category=ongoing&status=pickUpReady,delivered");
    expect(idsOf(res)).toEqual(idsFor("readySelf", "readyRider"));
  });

  it("rejects an unknown status with 400 instead of ignoring it", async () => {
    const res = await list("status=pending&status=shipped");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid status: shipped/);
  });
});
