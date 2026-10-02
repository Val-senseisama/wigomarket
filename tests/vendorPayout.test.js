/**
 * Vendor payout tests: who gets paid the vendor share of an order.
 *
 * Runs processWebhookPayload end-to-end (it needs the replica-set test DB for
 * its transaction) and the pure helpers behind every settlement path.
 */

const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const { processWebhookPayload } = require("../services/webhookPaymentProcessor");
const { calculateCommissionBreakdown, vendorShares } = require("../services/commissionService");
const {
  orderPaymentEntries,
  storeRefundEntries,
  withWalletShortfalls,
} = require("../services/orderPaymentLedger");
const { createTestUser, getOrCreateCategory } = require("./helpers");

let seq = 0;

const makeSeller = async () => {
  const { user } = await createTestUser({ role: ["seller"], activeRole: "seller" });
  const n = `${Date.now()}${++seq}`;
  const store = await Store.create({
    name: `Payout Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    owner: user._id,
    address: "1 Test Street",
    email: `payout-${n}@example.com`,
    ownerNIN: `${n.slice(-11)}`,
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
  return { user, store };
};

const makeProduct = async (store, price, listedPrice) => {
  const category = await getOrCreateCategory();
  const n = `${Date.now()}${++seq}`;
  return Product.create({
    title: `Payout Product ${n}`,
    slug: `payout-product-${n}`,
    description: "A product used by the payout tests",
    price,
    listedPrice,
    quantity: 10,
    store: store._id,
    category: category._id,
  });
};

/** An unpaid order, with prices snapshotted on its lines the way createOrder does. */
const makeOrder = async (customer, lines) => {
  const total = lines.reduce((t, l) => t + l.product.listedPrice * (l.count ?? 1), 0);
  return Order.create({
    products: lines.map((l) => ({
      product: l.product._id,
      count: l.count ?? 1,
      store: l.store._id,
      price: l.product.price,
      listedPrice: l.product.listedPrice,
    })),
    orderedBy: customer._id,
    deliveryMethod: "self_delivery",
    deliveryAddress: "1 Test Road, Lagos",
    paymentStatus: "Unpaid",
    paymentIntent: { id: `tx-${Date.now()}-${++seq}`, amount: total, currency: "NGN" },
  });
};

const webhookFor = (order) => ({
  event: "charge.completed",
  data: {
    status: "successful",
    tx_ref: order.paymentIntent.id,
    id: `${Date.now()}${++seq}`,
    amount: order.paymentIntent.amount,
  },
});

const balanceOf = async (userId) => (await Wallet.findOne({ user: userId }))?.balance ?? null;

describe("vendor payouts on payment", () => {
  it("pays each store's owner their own share of a multi-store order", async () => {
    const { user: customer } = await createTestUser();
    const a = await makeSeller();
    const b = await makeSeller();
    const rice = await makeProduct(a.store, 3000, 3300);
    const beans = await makeProduct(b.store, 1000, 1100);
    const order = await makeOrder(customer, [
      { product: rice, store: a.store },
      { product: beans, store: b.store, count: 2 },
    ]);

    await processWebhookPayload(webhookFor(order));

    expect(await balanceOf(a.user._id)).toBe(3000);
    expect(await balanceOf(b.user._id)).toBe(2000);
    // Nothing lands in a wallet keyed by a store id.
    expect(await Wallet.findOne({ user: { $in: [a.store._id, b.store._id] } })).toBeNull();

    const tx = await Transaction.findOne({ reference: `Payment-${order._id}` });
    const credits = tx.entries
      .filter((e) => e.account === "wallet_vendor")
      .map((e) => [String(e.userId), e.credit])
      .sort();
    expect(credits).toEqual(
      [
        [String(a.user._id), 3000],
        [String(b.user._id), 2000],
      ].sort(),
    );
    expect(tx.commission.vendorAmount).toBe(5000);
    expect(tx.commission.platformAmount).toBe(500);
    const totalDebits = tx.entries.reduce((t, e) => t + e.debit, 0);
    const totalCredits = tx.entries.reduce((t, e) => t + e.credit, 0);
    expect(totalDebits).toBe(order.paymentIntent.amount);
    expect(totalCredits).toBe(order.paymentIntent.amount);

    const paid = await Order.findById(order._id);
    expect(paid.paymentStatus).toBe("Paid");
  });

  it("pays the price captured on the order, not the product's current price", async () => {
    const { user: customer } = await createTestUser();
    const seller = await makeSeller();
    const product = await makeProduct(seller.store, 4000, 4400);
    const order = await makeOrder(customer, [{ product, store: seller.store }]);

    await Product.updateOne({ _id: product._id }, { price: 9999, listedPrice: 12000 });
    await processWebhookPayload(webhookFor(order));

    expect(await balanceOf(seller.user._id)).toBe(4000);
  });

  it("leaves the order unpaid and credits nobody when a store has no owner", async () => {
    const { user: customer } = await createTestUser();
    const seller = await makeSeller();
    const product = await makeProduct(seller.store, 1000, 1100);
    const order = await makeOrder(customer, [{ product, store: seller.store }]);
    await Store.collection.updateOne({ _id: seller.store._id }, { $unset: { owner: "" } });

    await expect(processWebhookPayload(webhookFor(order))).rejects.toThrow(/has no owner/);

    expect(await balanceOf(seller.user._id)).toBeNull();
    expect((await Order.findById(order._id)).paymentStatus).toBe("Unpaid");
    expect(await Transaction.findOne({ reference: `Payment-${order._id}` })).toBeNull();
  });
});

describe("commission helpers", () => {
  it("falls back to the product price for orders without a snapshot", () => {
    const store = new mongoose.Types.ObjectId();
    const order = {
      products: [{ product: { price: 1000.1, listedPrice: 1100.2, store }, count: 3 }],
      paymentIntent: { amount: 3300.6 },
    };
    expect(calculateCommissionBreakdown(order)).toMatchObject({
      vendorAmount: 3000.3,
      platformAmount: 300.3,
    });
    expect(vendorShares(order)).toEqual([{ storeId: store, amount: 3000.3 }]);
  });

  it("merges several lines from one store into one share", () => {
    const s1 = new mongoose.Types.ObjectId();
    const s2 = new mongoose.Types.ObjectId();
    const shares = vendorShares({
      products: [
        { store: s1, price: 0.1, count: 1 },
        { store: s2, price: 5, count: 1 },
        { store: s1, price: 0.2, count: 1 },
      ],
    });
    expect(shares).toEqual([
      { storeId: s1, amount: 0.3 },
      { storeId: s2, amount: 5 },
    ]);
  });

});

describe("order payment ledger", () => {
  const u1 = new mongoose.Types.ObjectId();
  const u2 = new mongoose.Types.ObjectId();
  const customer = new mongoose.Types.ObjectId();
  const payouts = [
    { storeId: new mongoose.Types.ObjectId(), userId: u1, amount: 3000 },
    { storeId: new mongoose.Types.ObjectId(), userId: u2, amount: 2000 },
  ];
  const sides = (entries) => ({
    debits: entries.reduce((t, e) => t + e.debit, 0),
    credits: entries.reduce((t, e) => t + e.credit, 0),
  });
  const line = (entries, account, userId) =>
    entries.find((e) => e.account === account && (userId === undefined || String(e.userId) === String(userId)));

  it("balances to the amount paid, holds the delivery fee, and gives the platform the rest", () => {
    const ledger = orderPaymentEntries({
      order: { _id: "o1", orderedBy: customer, deliveryFee: 800, paymentIntent: { amount: 6300 } },
      payouts,
    });

    expect(sides(ledger.entries)).toEqual({ debits: 6300, credits: 6300 });
    expect(ledger.totalAmount).toBe(6300);
    expect(line(ledger.entries, "cash_account").debit).toBe(6300);
    expect(line(ledger.entries, "wallet_vendor", u1).credit).toBe(3000);
    expect(line(ledger.entries, "wallet_vendor", u2).credit).toBe(2000);
    expect(line(ledger.entries, "accounts_payable").credit).toBe(800);
    expect(line(ledger.entries, "commission_revenue").credit).toBe(500);
    expect(ledger.platformAmount).toBe(500);
    // VAT is a memo on the transaction, never a ledger line.
    expect(ledger.entries.some((e) => e.account.startsWith("vat_"))).toBe(false);
  });

  it("has the platform cover a shortfall instead of short-paying sellers", () => {
    const ledger = orderPaymentEntries({
      order: { _id: "o2", orderedBy: customer, deliveryFee: 0, paymentIntent: { amount: 4900 } },
      payouts,
    });

    expect(line(ledger.entries, "commission_revenue").debit).toBe(100);
    expect(sides(ledger.entries)).toEqual({ debits: 5000, credits: 5000 });
    expect(ledger.totalAmount).toBe(5000);
  });

  it("refunds one seller's items: buyer's cash back, seller share and platform margin returned", () => {
    const refund = storeRefundEntries({ buyerId: customer, sellerId: u1, amount: 3300, vendorAmount: 3000 });

    expect(sides(refund.entries)).toEqual({ debits: 3300, credits: 3300 });
    expect(refund.totalAmount).toBe(3300);
    expect(line(refund.entries, "cash_account").credit).toBe(3300);
    expect(line(refund.entries, "wallet_vendor", u1).debit).toBe(3000);
    expect(line(refund.entries, "commission_revenue").debit).toBe(300);
    expect(refund.walletDebits).toEqual([{ account: "wallet_vendor", userId: u1, amount: 3000 }]);
  });

  it("books what a seller cannot cover as owed by them, keeping the ledger balanced", () => {
    const refund = storeRefundEntries({ buyerId: customer, sellerId: u1, amount: 3300, vendorAmount: 3000 });
    const entries = withWalletShortfalls(refund.entries, [
      { userId: u1, account: "wallet_vendor", outstanding: 2000 },
    ]);

    expect(sides(entries)).toEqual({ debits: 3300, credits: 3300 });
    expect(line(entries, "wallet_vendor", u1).debit).toBe(1000);
    expect(line(entries, "accounts_receivable", u1).debit).toBe(2000);
  });
});
