/**
 * Seller Earnings & Transactions tests.
 *
 * Like storeAnalytics.test.js, these call the controller directly with a stub
 * req/res: the route is a one-liner (`authMiddleware, isSeller, ...`) and all
 * the risk is in the aggregation.
 */

const mongoose = require("mongoose");
const { DateTime } = require("luxon");
const getStoreEarnings = require("../controllers/store/getStoreEarnings");
const getRecentEarnings = require("../controllers/store/getRecentEarnings");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Category = require("../models/categoryModel");
const Refund = require("../models/refundModel");
const { createTestUser } = require("./helpers");

const LAGOS = "Africa/Lagos";

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
  await getStoreEarnings({ store: store?._id ?? store, query }, res, (err) => {
    if (err) throw err;
  });
  return res;
};

let seq = 0;

const makeStore = async () => {
  const n = `${Date.now()}${++seq}`;
  return Store.create({
    name: `Earnings Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    owner: new mongoose.Types.ObjectId(),
    address: "1 Test Street",
    email: `earn-store-${n}@example.com`,
    ownerNIN: `${n.slice(-11)}`,
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
};

const makeProduct = async (storeId, overrides = {}) => {
  const category = await Category.findOneAndUpdate(
    { name: "Earnings Test Category" },
    { name: "Earnings Test Category" },
    { upsert: true, new: true },
  );
  const n = `${Date.now()}${++seq}`;
  return Product.create({
    title: `Product ${n}`,
    slug: `product-${n}`,
    description: "A product used by the earnings tests",
    price: 5000,
    listedPrice: 5500,
    quantity: 10,
    store: storeId,
    category: category._id,
    images: [`https://img.example.com/${n}.jpg`],
    ...overrides,
  });
};

/**
 * Create an order. `at` back-dates createdAt and the payment time so a test can
 * place it in any window.
 */
const makeOrder = async ({
  lines,
  customer,
  paymentStatus = "Paid",
  at = new Date(),
  paidAt = at,
  orderNumber,
}) => {
  const order = await Order.create({
    orderNumber: orderNumber ?? `WM${Date.now()}${++seq}`,
    products: lines.map((l) => ({
      product: l.product._id,
      count: l.count ?? 1,
      store: l.store._id,
    })),
    orderedBy: customer?._id ?? new mongoose.Types.ObjectId(),
    orderStatus: "confirmed",
    deliveryMethod: "delivery_agent",
    deliveryAddress: "1 Test Road, Lagos",
    paymentStatus,
    paymentIntent: { amount: 1000, currency: "NGN" },
  });

  await Order.collection.updateOne(
    { _id: order._id },
    {
      $set: {
        createdAt: at,
        updatedAt: at,
        ...(paidAt && { "paymentIntent.paid_at": paidAt }),
      },
    },
  );
  return order;
};

/** A refund of `vendorAmount` of this store's share of `order`, in `status`. */
const settledRefund = (order, store, vendorAmount, status = "settled") => {
  const _id = new mongoose.Types.ObjectId();
  return Refund.create({
    _id,
    order: order._id,
    store: store._id,
    seller: new mongoose.Types.ObjectId(),
    buyer: new mongoose.Types.ObjectId(),
    idempotencyKey: `refund:${_id}`,
    items: [],
    amount: vendorAmount,
    vendorAmount,
    platformAmount: 0,
    reason: "damaged",
    status,
    open: status !== "settled",
    respondBy: new Date(),
    providerTransactionId: "test",
  });
};

const now = () => DateTime.now().setZone(LAGOS);

describe("getStoreEarnings", () => {
  it("404s when the seller has no store", async () => {
    const res = await run(null);
    expect(res.statusCode).toBe(404);
  });

  it("returns zeroed cards and an empty table for a new store", async () => {
    const store = await makeStore();
    const res = await run(store);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.summary.totalEarnings).toEqual({ value: 0, previous: 0, changePercent: 0 });
    expect(res.body.data.summary.weeklyEarnings.value).toBe(0);
    expect(res.body.data.summary.todayEarnings.value).toBe(0);
    expect(res.body.data.earnings).toEqual([]);
    expect(res.body.data.pagination).toMatchObject({ total: 0, page: 1, pages: 0, hasMore: false });
  });

  it("returns the table row the design needs, at vendor price", async () => {
    const store = await makeStore();
    const { user: customer } = await createTestUser({ fullName: "Gilbert Johnston" });
    const product = await makeProduct(store._id, { title: "Indomie Noodles (40 Pack)", price: 2500 });
    await makeOrder({ lines: [{ product, store, count: 2 }], customer, orderNumber: "WM1201" });

    const res = await run(store);
    const [row] = res.body.data.earnings;

    expect(row).toMatchObject({
      orderNumber: "#WM1201",
      productSold: "Indomie Noodles (40 Pack)",
      customer: { id: customer._id, name: "Gilbert Johnston" },
      amountEarned: 5000,
      currency: "NGN",
      status: "paid",
      statusLabel: "Paid",
    });
    expect(row.products).toEqual([
      expect.objectContaining({ title: "Indomie Noodles (40 Pack)", quantity: 2, unitPrice: 2500, amount: 5000 }),
    ]);
    expect(row.orderDate).toBeTruthy();
  });

  it("counts only this store's share of a multi-store order", async () => {
    const mine = await makeStore();
    const other = await makeStore();
    const a = await makeProduct(mine._id, { title: "Rice", price: 3000 });
    const b = await makeProduct(mine._id, { title: "Beans", price: 1000 });
    const c = await makeProduct(other._id, { price: 9000 });
    await makeOrder({
      lines: [
        { product: a, store: mine },
        { product: b, store: mine, count: 2 },
        { product: c, store: other },
      ],
    });

    const res = await run(mine);
    const [row] = res.body.data.earnings;

    expect(row.amountEarned).toBe(5000);
    expect(row.productSold).toBe("Rice +1 more");
    expect(row.products).toHaveLength(2);
    expect(res.body.data.summary.totalEarnings.value).toBe(5000);
  });

  it("excludes unpaid orders and nets settled refunds out of the store's earning", async () => {
    const store = await makeStore();
    const other = await makeStore();
    const product = await makeProduct(store._id, { price: 1000 });
    const otherProduct = await makeProduct(other._id, { price: 700 });

    await makeOrder({ lines: [{ product, store }] });
    await makeOrder({ lines: [{ product, store }], paymentStatus: "Unpaid", paidAt: null });
    const partial = await makeOrder({ lines: [{ product, store, count: 2 }], paymentStatus: "Partially Refunded" });
    const full = await makeOrder({
      lines: [{ product, store }, { product: otherProduct, store: other }],
      paymentStatus: "Partially Refunded",
    });

    await settledRefund(partial, store, 1000); // 1 of 2 units
    await settledRefund(full, store, 1000); // all of this store's part
    await settledRefund(full, other, 700); // another store's refund: must not count here
    // An approved-but-unpaid refund does not change the row yet.
    await settledRefund(partial, store, 1000, "approved");

    const res = await run(store);
    const byId = Object.fromEntries(res.body.data.earnings.map((r) => [String(r.id), r]));

    expect(res.body.data.earnings).toHaveLength(3);
    expect(byId[partial._id]).toMatchObject({
      status: "partially_refunded",
      statusLabel: "Partially refunded",
      grossAmount: 2000,
      refundedAmount: 1000,
      amountEarned: 1000,
    });
    expect(byId[full._id]).toMatchObject({ status: "refunded", amountEarned: 0, refundedAmount: 1000 });
    expect(res.body.data.summary.totalEarnings.value).toBe(2000);
    expect(res.body.data.summary.paidOrders).toBe(2);

    const refunded = await run(store, { status: "refunded" });
    expect(refunded.body.data.earnings.map((r) => String(r.id))).toEqual([String(full._id)]);
  });

  it("splits the cards into today, this week and lifetime", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 1000 });
    const t = now();

    // Today, an hour after midnight — inside both today and this week.
    await makeOrder({ lines: [{ product, store }], at: t.startOf("day").plus({ minutes: 1 }).toJSDate() });
    // Yesterday at the same point — today's comparison window.
    await makeOrder({
      lines: [{ product, store, count: 2 }],
      at: t.startOf("day").minus({ days: 1 }).plus({ minutes: 1 }).toJSDate(),
    });
    // Months ago — lifetime only.
    await makeOrder({ lines: [{ product, store, count: 5 }], at: t.minus({ months: 3 }).toJSDate() });

    const { summary } = (await run(store)).body.data;

    expect(summary.totalEarnings.value).toBe(8000);
    expect(summary.todayEarnings).toEqual({ value: 1000, previous: 2000, changePercent: -50 });
    // Yesterday falls in this week unless today is Monday.
    expect(summary.weeklyEarnings.value).toBe(t.weekday === 1 ? 1000 : 3000);
  });

  it("uses payment time for the cards, not order time", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 1000 });
    // Ordered last month, paid just now.
    await makeOrder({
      lines: [{ product, store }],
      at: now().minus({ months: 1 }).toJSDate(),
      paidAt: new Date(),
    });

    const { summary } = (await run(store)).body.data;
    expect(summary.todayEarnings.value).toBe(1000);
  });

  it("searches by product name, customer name, order number and amount", async () => {
    const store = await makeStore();
    const { user: gilbert } = await createTestUser({ fullName: "Gilbert Johnston" });
    const { user: ada } = await createTestUser({ fullName: "Ada Obi" });
    const noodles = await makeProduct(store._id, { title: "Indomie Noodles (40 Pack)", price: 5000 });
    const rice = await makeProduct(store._id, { title: "Mama Gold Rice", price: 1250.5 });
    await makeOrder({ lines: [{ product: noodles, store }], customer: gilbert, orderNumber: "WM1201" });
    await makeOrder({ lines: [{ product: rice, store }], customer: ada, orderNumber: "WM1202" });

    const titles = async (search) =>
      (await run(store, { search, summary: "false" })).body.data.earnings.map((r) => r.productSold);

    expect(await titles("indomie")).toEqual(["Indomie Noodles (40 Pack)"]);
    expect(await titles("gilbert")).toEqual(["Indomie Noodles (40 Pack)"]);
    expect(await titles("#WM1202")).toEqual(["Mama Gold Rice"]);
    expect(await titles("₦5,000")).toEqual(["Indomie Noodles (40 Pack)"]);
    expect(await titles("1,250.50")).toEqual(["Mama Gold Rice"]);
    // A digit-bearing product phrase is a text search, not an amount.
    expect(await titles("40 Pack")).toEqual(["Indomie Noodles (40 Pack)"]);
    // Regex metacharacters are literal.
    expect(await titles("(40")).toEqual(["Indomie Noodles (40 Pack)"]);
    expect(await titles("nothing matches")).toEqual([]);
  });

  it("does not let table filters change the summary cards", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 1000, title: "Garri" });
    await makeOrder({ lines: [{ product, store }] });

    const res = await run(store, { search: "no such thing" });
    expect(res.body.data.earnings).toEqual([]);
    expect(res.body.data.summary.totalEarnings.value).toBe(1000);
  });

  it("filters by order date, treating a bare dateTo as the end of that day", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 1000 });
    const day = DateTime.fromISO("2026-09-10", { zone: LAGOS });
    await makeOrder({ lines: [{ product, store }], at: day.plus({ hours: 20 }).toJSDate() });
    await makeOrder({ lines: [{ product, store }], at: day.plus({ days: 2 }).toJSDate() });

    const sameDay = await run(store, { dateFrom: "2026-09-10", dateTo: "2026-09-10" });
    expect(sameDay.body.data.earnings).toHaveLength(1);

    const fromOnly = await run(store, { dateFrom: "2026-09-11" });
    expect(fromOnly.body.data.earnings).toHaveLength(1);
  });

  it("400s on an unparseable or inverted date range, or unknown status", async () => {
    const store = await makeStore();
    expect((await run(store, { dateFrom: "yesterday-ish" })).statusCode).toBe(400);
    expect((await run(store, { dateFrom: "2026-09-12", dateTo: "2026-09-10" })).statusCode).toBe(400);
    expect((await run(store, { status: "pending" })).statusCode).toBe(400);
  });

  it("paginates newest first, sorts by amount, and can skip the summary", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 100 });
    const t = now();
    for (let i = 1; i <= 12; i++) {
      await makeOrder({ lines: [{ product, store, count: i }], at: t.minus({ hours: i }).toJSDate() });
    }

    const page1 = await run(store, { limit: 5 });
    expect(page1.body.data.pagination).toMatchObject({ total: 12, pages: 3, hasMore: true });
    expect(page1.body.data.earnings[0].amountEarned).toBe(100); // newest = 1 unit

    const page3 = await run(store, { limit: 5, page: 3, summary: "false" });
    expect(page3.body.data.earnings).toHaveLength(2);
    expect(page3.body.data.pagination.hasMore).toBe(false);
    expect(page3.body.data.summary).toBeUndefined();

    const byAmount = await run(store, { sortBy: "amount", limit: 1 });
    expect(byAmount.body.data.earnings[0].amountEarned).toBe(1200);
  });
});

describe("getRecentEarnings", () => {
  const runRecent = async (store, query = {}) => {
    const res = makeRes();
    await getRecentEarnings({ store: store?._id ?? store, query }, res, (err) => {
      if (err) throw err;
    });
    return res;
  };

  it("404s when the seller has no store", async () => {
    expect((await runRecent(null)).statusCode).toBe(404);
  });

  it("returns the latest few sales, newest payment first, with the widget's wording", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 1000 });
    const t = now();
    for (let i = 1; i <= 7; i++) {
      await makeOrder({ lines: [{ product, store, count: i }], at: t.minus({ hours: i }).toJSDate() });
    }
    await makeOrder({ lines: [{ product, store }], paymentStatus: "Unpaid", paidAt: null });

    const res = await runRecent(store);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.earnings.map((e) => e.amount)).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(res.body.data.earnings[0]).toMatchObject({
      type: "sale",
      title: "Sales",
      status: "paid",
      statusLabel: "Successful",
      currency: "NGN",
    });
    expect(res.body.data.earnings[0].orderNumber).toMatch(/^#/);
    expect(res.body.data.earnings[0].earnedAt).toBeTruthy();

    expect((await runRecent(store, { limit: 2 })).body.data.earnings).toHaveLength(2);
    expect((await runRecent(store, { limit: 500 })).body.data.earnings).toHaveLength(7);
  });

  it("orders by payment time and shows the same net amount as the earnings table", async () => {
    const store = await makeStore();
    const product = await makeProduct(store._id, { price: 1000 });
    // Placed long ago but paid just now: it is the most recent earning.
    const late = await makeOrder({
      lines: [{ product, store, count: 3 }],
      at: now().minus({ days: 20 }).toJSDate(),
      paidAt: new Date(),
      paymentStatus: "Partially Refunded",
    });
    await makeOrder({ lines: [{ product, store }], at: now().minus({ hours: 1 }).toJSDate() });
    await settledRefund(late, store, 1000);

    const recent = (await runRecent(store)).body.data.earnings;
    expect(String(recent[0].id)).toBe(String(late._id));
    expect(recent[0]).toMatchObject({
      amount: 2000,
      grossAmount: 3000,
      refundedAmount: 1000,
      status: "partially_refunded",
      statusLabel: "Partially refunded",
    });

    const table = (await run(store)).body.data.earnings.find((r) => String(r.id) === String(late._id));
    expect(table.amountEarned).toBe(recent[0].amount);
  });

  it("only counts this store's share of a multi-store order", async () => {
    const mine = await makeStore();
    const other = await makeStore();
    const a = await makeProduct(mine._id, { price: 1500 });
    const b = await makeProduct(other._id, { price: 9000 });
    await makeOrder({ lines: [{ product: a, store: mine }, { product: b, store: other }] });

    const [entry] = (await runRecent(mine)).body.data.earnings;
    expect(entry.amount).toBe(1500);
  });
});

