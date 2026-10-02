/**
 * Recent Orders widget: GET /api/store/orders/recent, and the live /ws/orders
 * feed that keeps it current.
 */
jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const request = require("supertest");
const app = require("../app");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const { transitionOrder } = require("../services/orderTransitionService");
const { publishStoreOrderEvent, onLocalEvent, EVENT } = require("../services/storeOrderEvents");
const StoreOrdersWebSocketServer = require("../websocket/storeOrdersWebSocket");
const LocationWebSocketServer = require("../websocket/locationWebSocket");
const { attachWebSockets } = require("../websocket/upgradeRouter");
const { createTestUser, getOrCreateCategory, makeToken } = require("./helpers");

let seq = 0;

const makeSeller = async () => {
  const { user, token } = await createTestUser({ role: ["seller"], activeRole: "seller" });
  const n = `${Date.now()}${++seq}`;
  const store = await Store.create({
    name: `Recent Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    owner: user._id,
    address: "1 Test Street",
    email: `recent-${n}@example.com`,
    ownerNIN: `${n.slice(-11)}`,
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
  return { user, token, store };
};

const makeProduct = async (store, listedPrice) => {
  const category = await getOrCreateCategory();
  const n = `${Date.now()}${++seq}`;
  return Product.create({
    title: `Recent Product ${n}`,
    slug: `recent-product-${n}`,
    description: "A product used by the recent orders tests",
    price: listedPrice - 100,
    listedPrice,
    quantity: 50,
    store: store._id,
    category: category._id,
  });
};

/** lines: [{ product, store, count }] — prices snapshotted like createOrder does. */
const makeOrder = async (buyer, lines, at = new Date(), extra = {}) => {
  const order = await Order.create({
    orderNumber: `WM${Date.now()}${++seq}`,
    products: lines.map((l) => ({
      product: l.product._id,
      count: l.count ?? 1,
      store: l.store._id,
      price: l.product.price,
      listedPrice: l.product.listedPrice,
    })),
    orderedBy: buyer._id,
    deliveryMethod: "self_delivery",
    deliveryAddress: "1 Test Road",
    paymentStatus: "Paid",
    deliveryFee: 800,
    paymentIntent: { amount: 99999, currency: "NGN" },
    ...extra,
  });
  await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: at } });
  return order;
};

describe("GET /api/store/orders/recent", () => {
  it("returns the newest orders with this store's items and amount only", async () => {
    const seller = await makeSeller();
    const other = await makeSeller();
    const { user: buyer } = await createTestUser({ fullName: "Gilbert Johnston" });
    const mine = await makeProduct(seller.store, 1000);
    const theirs = await makeProduct(other.store, 5000);

    for (let i = 1; i <= 6; i++) {
      await makeOrder(buyer, [{ product: mine, store: seller.store, count: i }], new Date(Date.now() - i * 60_000));
    }
    const mixed = await makeOrder(buyer, [
      { product: mine, store: seller.store, count: 2 },
      { product: theirs, store: other.store, count: 3 },
    ]);
    await makeOrder(buyer, [{ product: theirs, store: other.store }]); // not this store's

    const res = await request(app)
      .get("/api/store/orders/recent")
      .set("Authorization", `Bearer ${seller.token}`);

    expect(res.status).toBe(200);
    const rows = res.body.data.orders;
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      id: String(mixed._id),
      items: 2,
      amount: 2000, // not the other seller's ₦15,000, nor the delivery fee
      currency: "NGN",
      customer: { name: "Gilbert Johnston" },
      status: "pending",
      statusLabel: "Pending",
      paymentStatus: "Paid",
    });
    expect(rows[0].orderNumber).toMatch(/^#WM/);
    expect(rows.slice(1).map((r) => r.items)).toEqual([1, 2, 3, 4]);
    expect(res.body.data.live).toEqual({ path: "/ws/orders", events: ["order.created", "order.updated"] });

    const two = await request(app)
      .get("/api/store/orders/recent?limit=2")
      .set("Authorization", `Bearer ${seller.token}`);
    expect(two.body.data.orders).toHaveLength(2);
  });

  it("is seller-only", async () => {
    const { token } = await createTestUser();
    const res = await request(app).get("/api/store/orders/recent").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("what sellers see", () => {
  it("hides unpaid card/bank checkouts but shows cash orders straight away", async () => {
    const seller = await makeSeller();
    const { user: buyer } = await createTestUser();
    const product = await makeProduct(seller.store, 1000);
    const line = [{ product, store: seller.store }];

    const paidCard = await makeOrder(buyer, line, new Date(), { paymentMethod: "card" });
    const unpaidCard = await makeOrder(buyer, line, new Date(), { paymentMethod: "card", paymentStatus: "Unpaid" });
    await makeOrder(buyer, line, new Date(), { paymentMethod: "bank", paymentStatus: "Failed" });
    const unpaidCash = await makeOrder(buyer, line, new Date(), { paymentMethod: "cash", paymentStatus: "Unpaid" });

    const auth = { Authorization: `Bearer ${seller.token}` };
    const recent = await request(app).get("/api/store/orders/recent").set(auth);
    const list = await request(app).get("/api/store/orders").set(auth);

    const expected = [String(paidCard._id), String(unpaidCash._id)].sort();
    expect(recent.body.data.orders.map((o) => String(o.id)).sort()).toEqual(expected);
    expect(list.body.data.orders.map((o) => String(o.id)).sort()).toEqual(expected);
    // Tab counts use the same scope.
    expect(list.body.data.counts.all).toBe(2);

    // No live event for an order sellers cannot see yet.
    expect(await publishStoreOrderEvent(unpaidCard._id, EVENT.CREATED)).toEqual([]);
  });

  it("shows the same store-scoped items and amount in the full list as in the widget", async () => {
    const seller = await makeSeller();
    const other = await makeSeller();
    const { user: buyer } = await createTestUser();
    const mine = await makeProduct(seller.store, 1000);
    const theirs = await makeProduct(other.store, 5000);
    const order = await makeOrder(buyer, [
      { product: mine, store: seller.store, count: 2 },
      { product: theirs, store: other.store, count: 3 },
    ]);

    const auth = { Authorization: `Bearer ${seller.token}` };
    const [row] = (await request(app).get("/api/store/orders").set(auth)).body.data.orders;
    const [widget] = (await request(app).get("/api/store/orders/recent").set(auth)).body.data.orders;

    expect(String(row.id)).toBe(String(order._id));
    expect(row).toMatchObject({ itemsCount: 2, amount: 2000 });
    expect(widget).toMatchObject({ items: row.itemsCount, amount: row.amount });
  });
});

describe("store order events", () => {
  it("builds one event per store, each with that store's row", async () => {
    const a = await makeSeller();
    const b = await makeSeller();
    const { user: buyer } = await createTestUser();
    const pa = await makeProduct(a.store, 1000);
    const pb = await makeProduct(b.store, 3000);
    const order = await makeOrder(buyer, [
      { product: pa, store: a.store, count: 2 },
      { product: pb, store: b.store, count: 1 },
    ]);

    const events = await publishStoreOrderEvent(order._id, EVENT.CREATED);

    const byStore = Object.fromEntries(events.map((e) => [e.storeId, e]));
    expect(byStore[String(a.store._id)]).toMatchObject({ type: "order.created", order: { items: 2, amount: 2000 } });
    expect(byStore[String(b.store._id)]).toMatchObject({ order: { items: 1, amount: 3000 } });
  });

  it("never throws, even for a missing order", async () => {
    await expect(publishStoreOrderEvent(new mongoose.Types.ObjectId())).resolves.toEqual([]);
  });
});

describe("/ws/orders", () => {
  let server;
  let ordersWs;
  let locationWs;
  let port;

  beforeAll(async () => {
    server = http.createServer(app);
    ordersWs = new StoreOrdersWebSocketServer();
    locationWs = new LocationWebSocketServer();
    attachWebSockets(server, { "/ws/orders": ordersWs, "/ws/location": locationWs });
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    ordersWs.close();
    locationWs.close();
    await new Promise((resolve) => server.close(resolve));
  });

  /** Connect and collect messages; resolves once the first message arrives. */
  const connect = (path) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      const messages = [];
      const closed = new Promise((r) => ws.on("close", (code) => r(code)));
      ws.on("message", (raw) => {
        messages.push(JSON.parse(raw));
        if (messages.length === 1) resolve({ ws, messages, closed });
      });
      ws.on("close", (code) => resolve({ ws, messages, closed: Promise.resolve(code), closeCode: code }));
      ws.on("error", reject);
    });

  const waitFor = async (check, timeoutMs = 5000) => {
    const start = Date.now();
    for (;;) {
      const value = check();
      if (value) return value;
      if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it("pushes live updates to the right seller only", async () => {
    const seller = await makeSeller();
    const other = await makeSeller();
    const { user: buyer } = await createTestUser();
    const product = await makeProduct(seller.store, 1000);

    const mine = await connect(`/ws/orders?token=${seller.token}`);
    const theirs = await connect(`/ws/orders?token=${other.token}`);
    expect(mine.messages[0]).toMatchObject({ type: "connection", storeId: String(seller.store._id) });

    const order = await makeOrder(buyer, [{ product, store: seller.store, count: 3 }]);
    publishStoreOrderEvent(order._id, EVENT.CREATED);
    const created = await waitFor(() => mine.messages.find((m) => m.type === "order.created"));
    expect(created.order).toMatchObject({ id: String(order._id), items: 3, amount: 3000, status: "pending" });

    // A status change through the state machine is published automatically.
    await transitionOrder({ orderId: order._id, toStatus: "confirmed", role: "seller" });
    const updated = await waitFor(() => mine.messages.find((m) => m.type === "order.updated"));
    expect(updated.order).toMatchObject({ id: String(order._id), status: "confirmed", statusLabel: "Confirmed" });

    await new Promise((r) => setTimeout(r, 100));
    expect(theirs.messages.filter((m) => m.type !== "connection")).toEqual([]);

    mine.ws.close();
    theirs.ws.close();
  });

  it("rejects connections without a seller's token", async () => {
    const noToken = await connect("/ws/orders");
    expect(await noToken.closed).toBe(1008);

    const { token: buyerToken } = await createTestUser();
    const buyer = await connect(`/ws/orders?token=${buyerToken}`);
    expect(await buyer.closed).toBe(1008);
  });

  it("keeps /ws/location working alongside it, and refuses unknown paths", async () => {
    const { user } = await createTestUser();
    const location = await connect(`/ws/location?token=${makeToken(user._id)}`);
    expect(location.messages[0]).toMatchObject({ type: "connection" });
    location.ws.close();

    await expect(connect("/ws/nope")).rejects.toThrow(/404/);
  });
});

describe("local fallback", () => {
  it("delivers in-process when Redis is not connected", async () => {
    const seller = await makeSeller();
    const { user: buyer } = await createTestUser();
    const product = await makeProduct(seller.store, 1000);
    const order = await makeOrder(buyer, [{ product, store: seller.store }]);

    const seen = [];
    const off = onLocalEvent((e) => seen.push(e));
    const redis = require("../config/redisClient");
    const events = await publishStoreOrderEvent(order._id);
    off();

    if (redis.status === "ready") {
      expect(seen).toEqual([]); // went through Redis instead
    } else {
      expect(seen.map((e) => e.order.id)).toEqual(events.map((e) => e.order.id));
    }
  });
});
