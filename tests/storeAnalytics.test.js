/**
 * Business Analytics aggregation tests.
 *
 * These call the controller directly with a stub req/res rather than going
 * through supertest + app. The route layer is a one-liner
 * (`authMiddleware, isSeller, getBusinessAnalytics`) identical to the other
 * store endpoints; all the risk is in the aggregation, and testing it directly
 * keeps the suite fast and free of the app's external clients.
 */

const mongoose = require("mongoose");
const { DateTime } = require("luxon");
const getBusinessAnalytics = require("../controllers/store/getBusinessAnalytics");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Category = require("../models/categoryModel");

const LAGOS = "Africa/Lagos";

/** Minimal res double capturing status + body. */
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

const run = async (store, query = {}) => {
  const res = makeRes();
  await getBusinessAnalytics({ store: store?._id ?? store, query }, res, (err) => {
    if (err) throw err;
  });
  return res;
};

let seq = 0;

const makeStore = async () => {
  const n = `${Date.now()}${++seq}`;
  return Store.create({
    name: `Analytics Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    owner: new mongoose.Types.ObjectId(),
    address: "1 Test Street",
    // Unique — the collection has a unique index on email, so two stores in one
    // test both defaulting to null would collide.
    email: `store-${n}@example.com`,
    ownerNIN: `${n.slice(-11)}`,
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
};

const makeProduct = async (storeId, overrides = {}) => {
  const category = await Category.findOneAndUpdate(
    { name: "Analytics Test Category" },
    { name: "Analytics Test Category" },
    { upsert: true, new: true },
  );
  const n = `${Date.now()}${++seq}`;
  return Product.create({
    title: `Product ${n}`,
    slug: `product-${n}`,
    description: "A product used by the analytics tests",
    price: 5000,
    quantity: 10,
    store: storeId,
    category: category._id,
    ...overrides,
  });
};

/**
 * Create an order with line items from the given stores.
 * `at` back-dates createdAt/updatedAt (and the delivery time for delivered
 * orders) so a test can place an order inside any window it likes.
 */
const makeOrder = async ({ lines, status = "pending", at = new Date() }) => {
  const order = await Order.create({
    products: lines.map((l) => ({
      product: l.product._id,
      count: l.count ?? 1,
      store: l.store._id,
    })),
    orderedBy: new mongoose.Types.ObjectId(),
    orderStatus: status,
    deliveryMethod: "delivery_agent",
    deliveryAddress: "1 Test Road, Lagos",
    paymentIntent: { amount: 1000, currency: "NGN" },
    ...(status === "delivered" && { actualDeliveryTime: at }),
  });

  await Order.collection.updateOne(
    { _id: order._id },
    { $set: { createdAt: at, updatedAt: at } },
  );
  return order;
};

const now = () => DateTime.now().setZone(LAGOS);

describe("getBusinessAnalytics", () => {
  it("404s when the seller has no store", async () => {
    const res = await run(null);
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns zeroed metrics for a store with no orders", async () => {
    const store = await makeStore();

    const res = await run(store);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.period).toBe("today");
    expect(res.body.data.currency).toBe("NGN");
    expect(res.body.data.metrics).toEqual(res.body.data.periods.today);
    expect(res.body.data.metrics.totalSales).toEqual({
      value: 0,
      previous: 0,
      changePercent: 0,
    });
    expect(res.body.data.metrics.pendingOrders.value).toBe(0);
    expect(res.body.data.metrics.activeProducts.value).toBe(0);
  });

  it("counts today's pending orders and delivered sales", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 5000, listedPrice: 6000 });
    const at = now().startOf("day").plus({ hours: 1 }).toJSDate();

    await makeOrder({ lines: [{ product, store }], at });
    await makeOrder({ lines: [{ product, store }], at });
    await makeOrder({
      lines: [{ product, store, count: 2 }],
      status: "delivered",
      at,
    });

    const m = (await run(store)).body.data.metrics;

    expect(m.pendingOrders.value).toBe(2);
    expect(m.pendingOrdersValue.value).toBe(10000); // 2 orders × 5000
    expect(m.completedOrders.value).toBe(1);
    expect(m.totalSales.value).toBe(10000); // vendor price 5000 × 2 items
    expect(m.grossSales.value).toBe(12000); // listed price 6000 × 2 items
    expect(m.activeProducts.value).toBe(1);
  });

  it("compares against the same span in the previous period", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 5000 });
    const todayStart = now().startOf("day").toJSDate();
    const yesterdayStart = now().startOf("day").minus({ days: 1 }).toJSDate();

    await makeOrder({ lines: [{ product, store }], status: "delivered", at: todayStart });
    await makeOrder({ lines: [{ product, store }], status: "delivered", at: todayStart });
    await makeOrder({
      lines: [{ product, store }],
      status: "delivered",
      at: yesterdayStart,
    });

    const m = (await run(store)).body.data.metrics;

    expect(m.completedOrders.value).toBe(2);
    expect(m.completedOrders.previous).toBe(1);
    expect(m.completedOrders.changePercent).toBe(100);
  });

  it("excludes another store's line items from the seller's sales", async () => {
    const mine = await makeStore();
    const theirs = await makeStore();
    const myProduct = await makeProduct(mine._id, { price: 5000 });
    const theirProduct = await makeProduct(theirs._id, { price: 9000 });
    const at = now().startOf("day").toJSDate();

    await makeOrder({
      lines: [
        { product: myProduct, store: mine },
        { product: theirProduct, store: theirs },
      ],
      status: "delivered",
      at,
    });

    // Only this store's 5000 line, not the 14000 basket.
    expect((await run(mine)).body.data.metrics.totalSales.value).toBe(5000);
    expect((await run(theirs)).body.data.metrics.totalSales.value).toBe(9000);
  });

  it("returns every requested period in one call", async () => {
    const store = await makeStore();

    const res = await run(store, { period: "today,weekly,monthly" });

    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.body.data.periods)).toEqual(["today", "weekly", "monthly"]);
    expect(res.body.data.period).toBe("today");
    expect(res.body.data.metrics).toEqual(res.body.data.periods.today);
  });

  it("supports period=all and the day/week/month aliases", async () => {
    const store = await makeStore();

    const all = await run(store, { period: "all" });
    expect(Object.keys(all.body.data.periods).sort()).toEqual([
      "monthly",
      "today",
      "weekly",
    ]);

    const aliased = await run(store, { period: "week" });
    expect(Object.keys(aliased.body.data.periods)).toEqual(["weekly"]);
  });

  it("rejects an unknown period", async () => {
    const store = await makeStore();

    const res = await run(store, { period: "yearly" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/invalid period/i);
  });

  it("counts legacy status spellings", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 5000 });
    const at = now().startOf("day").toJSDate();

    const order = await makeOrder({ lines: [{ product, store }], at });
    // "Delivered" predates the state machine and is no longer a valid enum
    // value, so it has to be written straight to the collection.
    await Order.collection.updateOne(
      { _id: order._id },
      { $set: { orderStatus: "Delivered", actualDeliveryTime: at } },
    );

    const m = (await run(store)).body.data.metrics;

    expect(m.completedOrders.value).toBe(1);
    expect(m.totalSales.value).toBe(5000);
  });

  it("falls back to statusHistory when actualDeliveryTime is missing", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 5000 });
    const at = now().startOf("day").plus({ hours: 2 }).toJSDate();

    const order = await makeOrder({ lines: [{ product, store }], at });
    await Order.collection.updateOne(
      { _id: order._id },
      {
        $set: {
          orderStatus: "delivered",
          statusHistory: [{ status: "delivered", at, role: "seller" }],
        },
        $unset: { actualDeliveryTime: "" },
      },
    );

    expect((await run(store)).body.data.metrics.completedOrders.value).toBe(1);
  });

  it("ignores out-of-stock products in the active product count", async () => {
    const store = await makeStore();
    await makeProduct(store._id, { quantity: 4 });
    await makeProduct(store._id, { quantity: 0 });

    expect((await run(store)).body.data.metrics.activeProducts.value).toBe(1);
  });

  it("keeps money exact across many odd-priced line items", async () => {
    const store = await makeStore();
    // 0.1 + 0.2 territory: naive float summation drifts, kobo arithmetic does not.
    const product = await makeProduct(store._id, { price: 10.1, listedPrice: 20.2 });
    const at = now().startOf("day").toJSDate();

    for (let i = 0; i < 3; i++) {
      await makeOrder({ lines: [{ product, store }], status: "delivered", at });
    }

    const m = (await run(store)).body.data.metrics;
    expect(m.totalSales.value).toBe(30.3);
    expect(m.grossSales.value).toBe(60.6);
  });
});
