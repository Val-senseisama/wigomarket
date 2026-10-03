/**
 * Buyer → seller refund request tests (services/orderRefundService).
 *
 * Flutterwave's HTTP API, push notifications and admin emails are mocked;
 * everything else is real, including the Flutterwave adapter — orders are paid
 * through settleOrderPayment so each refund claws back from wallets that were
 * genuinely credited.
 */

// Stands in for Flutterwave's refund endpoint: called with { id, amount },
// returns Flutterwave's response body (or rejects like a network failure).
const mockRefund = jest.fn();
jest.mock("axios", () =>
  jest.fn(async (req) => {
    const m = req.url.match(/\/transactions\/([^/]+)\/refund$/);
    if (!m) throw new Error(`Unexpected HTTP call in test: ${req.method} ${req.url}`);
    return { status: 200, data: await mockRefund({ id: decodeURIComponent(m[1]), amount: req.data.amount }) };
  }),
);
jest.mock("../services/alertService", () => ({
  notifyAdmins: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/firebaseNotificationService", () => ({
  sendNotificationToUser: jest.fn().mockResolvedValue({}),
}));
jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const { makeToken } = require("./helpers");

const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Wallet = require("../models/walletModel");
const Refund = require("../models/refundModel");
const Notification = require("../models/notificationModel");
const Transaction = require("../models/transactionModel");
const { notifyAdmins } = require("../services/alertService");
const { settleOrderPayment } = require("../services/orderPaymentSettlement");
const appConfig = require("../config/appConfig");
const flutterwave = require("../services/payments/flutterwaveProvider");
const { transitionOrder } = require("../services/orderTransitionService");
const svc = require("../services/orderRefundService");
const { serializeRefund } = require("../utils/refundSerializer");
const { createTestUser, getOrCreateCategory } = require("./helpers");

let seq = 0;

const makeSeller = async () => {
  const { user } = await createTestUser({ role: ["seller"], activeRole: "seller" });
  const n = `${Date.now()}${++seq}`;
  const store = await Store.create({
    name: `Refund Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    owner: user._id,
    address: "1 Test Street",
    email: `refund-${n}@example.com`,
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
    title: `Refund Product ${n}`,
    slug: `refund-product-${n}`,
    description: "A product used by the refund tests",
    price,
    listedPrice,
    quantity: 8,
    sold: 2,
    store: store._id,
    category: category._id,
  });
};

const flwId = () => `${Date.now()}${++seq}`;

/**
 * Two-store order, paid via the webhook:
 *   store A: 2 × rice   (buyer paid ₦3,300 each, seller gets ₦3,000 each)
 *   store B: 1 × beans  (buyer paid ₦1,100,      seller gets ₦1,000)
 */
const paidOrder = async () => {
  const { user: buyer } = await createTestUser();
  const a = await makeSeller();
  const b = await makeSeller();
  const rice = await makeProduct(a.store, 3000, 3300);
  const beans = await makeProduct(b.store, 1000, 1100);
  const order = await Order.create({
    products: [
      { product: rice._id, count: 2, store: a.store._id, price: 3000, listedPrice: 3300 },
      { product: beans._id, count: 1, store: b.store._id, price: 1000, listedPrice: 1100 },
    ],
    orderedBy: buyer._id,
    deliveryMethod: "self_delivery",
    deliveryAddress: "1 Test Road, Lagos",
    paymentStatus: "Unpaid",
    paymentIntent: { id: `tx-${flwId()}`, amount: 7700, currency: "NGN" },
  });
  const chargeId = flwId();
  await settleOrderPayment({
    orderId: order._id,
    provider: "flutterwave",
    charge: { status: "succeeded", reference: order.paymentIntent.id, providerTransactionId: chargeId, amount: 7700, currency: "NGN" },
    source: "test",
    actor: { userId: null, role: "system", ip: "test" },
  });
  return { order: await Order.findById(order._id), buyer, a, b, rice, beans, chargeId };
};

const balanceOf = async (userId) => (await Wallet.findOne({ user: userId })).balance;
const flwSuccess = (id = flwId()) => ({ status: "success", data: { id, status: "completed" } });
const sides = (entries) => ({
  debits: entries.reduce((t, e) => t + e.debit, 0),
  credits: entries.reduce((t, e) => t + e.credit, 0),
});

/** Buyer asks store A for one bag of rice back. */
const requestRice = (ctx, extra = {}) =>
  svc.createRefundRequest({
    orderId: ctx.order._id,
    buyerId: ctx.buyer._id,
    storeId: ctx.a.store._id,
    items: [{ productId: ctx.rice._id, quantity: 1 }],
    reason: "damaged",
    details: "Torn bag",
    ...extra,
  });

const pastDeadline = (refund) =>
  Refund.updateOne({ _id: refund._id }, { $set: { respondBy: new Date(Date.now() - 1000) } });

beforeAll(() => {
  appConfig.payment.flutterwave.secretKey = "FLWSECK_TEST-refund-tests";
});

beforeEach(() => {
  mockRefund.mockReset();
  notifyAdmins.mockClear();
});

describe("buyer requests a refund from the seller", () => {
  it("prices the request at what the buyer paid, split into seller share and platform margin", async () => {
    const ctx = await paidOrder();
    const refund = await requestRice(ctx);

    expect(refund).toMatchObject({
      status: "requested",
      amount: 3300,
      vendorAmount: 3000,
      platformAmount: 300,
      reason: "damaged",
    });
    expect(String(refund.seller)).toBe(String(ctx.a.user._id));
    expect(refund.respondBy.getTime()).toBeGreaterThan(Date.now() + 2.9 * 24 * 3600 * 1000);
    // Seller notified; nothing has moved yet.
    expect(await Notification.countDocuments({ recipient: ctx.a.user._id, type: "refund_requested" })).toBe(1);
    expect(await balanceOf(ctx.a.user._id)).toBe(6000);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("defaults to everything still refundable from that seller", async () => {
    const ctx = await paidOrder();
    const refund = await svc.createRefundRequest({
      orderId: ctx.order._id,
      buyerId: ctx.buyer._id,
      storeId: ctx.a.store._id,
      reason: "wrong_item",
    });
    expect(refund.items).toEqual([expect.objectContaining({ quantity: 2, unitPrice: 3300 })]);
    expect(refund.amount).toBe(6600);
  });

  it("requires storeId on a multi-seller order, and rejects items from another seller", async () => {
    const ctx = await paidOrder();
    await expect(
      svc.createRefundRequest({ orderId: ctx.order._id, buyerId: ctx.buyer._id, reason: "damaged" }),
    ).rejects.toThrow(/storeId is required/);
    await expect(
      requestRice(ctx, { storeId: ctx.b.store._id }),
    ).rejects.toThrow(/not one of this seller's items/);
  });

  it("only lets the order's buyer request, and only one open request per seller", async () => {
    const ctx = await paidOrder();
    const { user: stranger } = await createTestUser();
    await expect(requestRice(ctx, { buyerId: stranger._id })).rejects.toMatchObject({ statusCode: 404 });

    await requestRice(ctx);
    await expect(requestRice(ctx)).rejects.toMatchObject({ statusCode: 409 });

    // A different seller in the same order is independent.
    await expect(
      svc.createRefundRequest({
        orderId: ctx.order._id,
        buyerId: ctx.buyer._id,
        storeId: ctx.b.store._id,
        reason: "missing_items",
      }),
    ).resolves.toMatchObject({ amount: 1100 });
  });

  it("refuses more than was bought, an unpaid order, or a request past the delivery window", async () => {
    const ctx = await paidOrder();
    await expect(
      requestRice(ctx, { items: [{ productId: ctx.rice._id, quantity: 3 }] }),
    ).rejects.toThrow(/Only 2/);

    await Order.updateOne(
      { _id: ctx.order._id },
      { $set: { orderStatus: "delivered", actualDeliveryTime: new Date(Date.now() - 8 * 24 * 3600 * 1000) } },
    );
    await expect(requestRice(ctx)).rejects.toThrow(/within 7 days of delivery/);

    await Order.updateOne({ _id: ctx.order._id }, { $set: { paymentStatus: "Unpaid" } });
    await expect(requestRice(ctx)).rejects.toThrow(/not been paid/);
  });

  it("reports what can still be refunded per seller", async () => {
    const ctx = await paidOrder();
    await requestRice(ctx);

    const data = await svc.getRefundableItems(ctx.order._id, ctx.buyer._id);
    const storeA = data.stores.find((s) => String(s.storeId) === String(ctx.a.store._id));
    const storeB = data.stores.find((s) => String(s.storeId) === String(ctx.b.store._id));

    expect(data.eligible).toBe(true);
    expect(storeA.canRequest).toBe(false);
    expect(storeA.reason).toMatch(/already an open refund request/);
    expect(storeA.items[0]).toMatchObject({ purchased: 2, refundedOrRequested: 1, refundable: 1 });
    expect(storeB.canRequest).toBe(true);
    expect(data.reasons.map((r) => r.value)).toContain("damaged");
  });
});

describe("seller decision", () => {
  it("approving refunds the card, claws back the seller's share, and books a balanced ledger", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    mockRefund.mockResolvedValue(flwSuccess("rf-1"));

    const refund = await svc.sellerApprove(request._id, ctx.a.store._id, { note: "Sorry!" });

    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(mockRefund).toHaveBeenCalledWith({ id: ctx.chargeId, amount: 3300 });
    expect(refund).toMatchObject({ status: "settled", approvedBy: "seller", providerRefundId: "rf-1" });

    // Only store A's wallet is touched, by its share only.
    expect(await balanceOf(ctx.a.user._id)).toBe(3000);
    expect(await balanceOf(ctx.b.user._id)).toBe(1000);

    const tx = await Transaction.findOne({ reference: `Refund-${refund._id}` });
    expect(sides(tx.entries)).toEqual({ debits: 3300, credits: 3300 });
    expect(tx.entries.find((e) => e.account === "cash_account").credit).toBe(3300);
    expect(tx.entries.find((e) => e.account === "wallet_vendor").debit).toBe(3000);
    expect(tx.entries.find((e) => e.account === "commission_revenue").debit).toBe(300);

    const order = await Order.findById(ctx.order._id);
    expect(order.paymentStatus).toBe("Partially Refunded");
    expect(order.paymentIntent.refunded_amount).toBe(3300);
    // Items are not restocked by a refund.
    expect((await Product.findById(ctx.rice._id)).quantity).toBe(8);

    expect(await Notification.countDocuments({ recipient: ctx.buyer._id, type: "order_refunded" })).toBe(1);
  });

  it("marks the order Refunded once every unit is refunded", async () => {
    const ctx = await paidOrder();
    mockRefund.mockImplementation(async () => flwSuccess());
    const ra = await svc.createRefundRequest({
      orderId: ctx.order._id, buyerId: ctx.buyer._id, storeId: ctx.a.store._id, reason: "damaged",
    });
    const rb = await svc.createRefundRequest({
      orderId: ctx.order._id, buyerId: ctx.buyer._id, storeId: ctx.b.store._id, reason: "damaged",
    });
    await svc.sellerApprove(ra._id, ctx.a.store._id);
    await svc.sellerApprove(rb._id, ctx.b.store._id);

    const order = await Order.findById(ctx.order._id);
    expect(order.paymentStatus).toBe("Refunded");
    expect(order.paymentIntent.refunded_amount).toBe(7700);
  });

  it("only the owning store can decide, and only once", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    mockRefund.mockResolvedValue(flwSuccess());

    await expect(svc.sellerApprove(request._id, ctx.b.store._id)).rejects.toMatchObject({ statusCode: 404 });
    await svc.sellerApprove(request._id, ctx.a.store._id);
    await expect(svc.sellerReject(request._id, ctx.a.store._id, { note: "no" })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("never pays out twice when the seller double-clicks approve", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    mockRefund.mockImplementation(() => new Promise((r) => setTimeout(() => r(flwSuccess()), 50)));

    const results = await Promise.allSettled([
      svc.sellerApprove(request._id, ctx.a.store._id),
      svc.sellerApprove(request._id, ctx.a.store._id),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(await balanceOf(ctx.a.user._id)).toBe(3000);
  });

  it("rejecting requires a reason and notifies the buyer", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);

    await expect(svc.sellerReject(request._id, ctx.a.store._id, {})).rejects.toThrow(/reason is required/);
    const refund = await svc.sellerReject(request._id, ctx.a.store._id, { note: "Delivered sealed" });

    expect(refund.status).toBe("rejected");
    expect(refund.sellerResponse).toMatchObject({ decision: "rejected", note: "Delivered sealed" });
    expect(await Notification.countDocuments({ recipient: ctx.buyer._id, type: "refund_rejected" })).toBe(1);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("still refunds when the seller already withdrew, booking the rest as owed by them", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    await Wallet.updateOne({ user: ctx.a.user._id }, { $set: { balance: 1000 } });
    mockRefund.mockResolvedValue(flwSuccess());

    const refund = await svc.sellerApprove(request._id, ctx.a.store._id);

    expect(refund.status).toBe("settled");
    expect(await balanceOf(ctx.a.user._id)).toBe(0);
    expect(refund.shortfalls).toEqual([
      expect.objectContaining({ owed: 3000, recovered: 1000, outstanding: 2000 }),
    ]);
    const tx = await Transaction.findOne({ reference: `Refund-${refund._id}` });
    expect(sides(tx.entries)).toEqual({ debits: 3300, credits: 3300 });
    expect(tx.entries.find((e) => e.account === "accounts_receivable")).toMatchObject({ debit: 2000 });
    expect(notifyAdmins).toHaveBeenCalledWith("Refund exceeded seller wallet balance", expect.any(String), expect.any(Object));
  });
});

describe("escalation to admin", () => {
  it("lets the buyer escalate a rejection, and an admin approval pays out", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    await svc.sellerReject(request._id, ctx.a.store._id, { note: "No" });

    const escalated = await svc.escalate(request._id, ctx.buyer._id, { note: "Photos attached" });
    expect(escalated.status).toBe("escalated");
    expect(notifyAdmins).toHaveBeenCalledWith("Refund request escalated", expect.any(String), expect.any(Object));

    mockRefund.mockResolvedValue(flwSuccess());
    const refund = await svc.adminDecide(request._id, { decision: "approve", note: "Evidence is clear" });
    expect(refund).toMatchObject({ status: "settled", approvedBy: "admin" });
    expect(await balanceOf(ctx.a.user._id)).toBe(3000);
  });

  it("only allows escalating a pending request after the seller's deadline", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);

    await expect(svc.escalate(request._id, ctx.buyer._id)).rejects.toThrow(/has until/);
    expect(serializeRefund(await Refund.findById(request._id), "buyer").allowedActions).toEqual(["withdraw"]);

    await pastDeadline(request);
    expect(serializeRefund(await Refund.findById(request._id), "buyer").allowedActions).toEqual([
      "escalate",
      "withdraw",
    ]);
    await expect(svc.escalate(request._id, ctx.buyer._id)).resolves.toMatchObject({ status: "escalated" });
    // The seller can no longer answer once it is escalated.
    await expect(svc.sellerApprove(request._id, ctx.a.store._id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("an admin decline is final and frees the seller slot", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    await svc.sellerReject(request._id, ctx.a.store._id, { note: "No" });
    await svc.escalate(request._id, ctx.buyer._id);

    const declined = await svc.adminDecide(request._id, { decision: "decline", note: "Not eligible" });
    expect(declined).toMatchObject({ status: "declined", open: false });
    await expect(svc.escalate(request._id, ctx.buyer._id)).rejects.toMatchObject({ statusCode: 409 });
    expect(await Notification.countDocuments({ recipient: ctx.buyer._id, type: "refund_declined" })).toBe(1);
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("admins can only decide escalated requests", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    await expect(svc.adminDecide(request._id, { decision: "approve" })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("withdrawing", () => {
  it("lets the buyer withdraw before a decision and request again", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    await expect(svc.withdraw(request._id, ctx.buyer._id)).resolves.toMatchObject({ status: "withdrawn" });
    await expect(requestRice(ctx)).resolves.toMatchObject({ status: "requested" });
  });
});

describe("payout failures", () => {
  it("a Flutterwave rejection fails safely and an admin can retry it", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    mockRefund.mockResolvedValueOnce({ status: "error", message: "Insufficient merchant balance" });

    const failed = await svc.sellerApprove(request._id, ctx.a.store._id);
    expect(failed.status).toBe("failed");
    expect(await balanceOf(ctx.a.user._id)).toBe(6000);
    expect(serializeRefund(failed, "buyer").statusLabel).toBe("Refund in progress");

    mockRefund.mockResolvedValueOnce(flwSuccess());
    const retried = await svc.resolveRefund(request._id, { outcome: "retry" });
    expect(retried.status).toBe("settled");
    expect(mockRefund).toHaveBeenCalledTimes(2);
  });

  it("an unknown outcome is dead-lettered, never retried, then resolved by an admin", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    mockRefund.mockRejectedValue(new Error("ETIMEDOUT"));

    const refund = await svc.sellerApprove(request._id, ctx.a.store._id);
    expect(refund.status).toBe("needs_review");

    await svc.recoverRefunds();
    expect(mockRefund).toHaveBeenCalledTimes(1);
    expect(await balanceOf(ctx.a.user._id)).toBe(6000);

    const resolved = await svc.resolveRefund(request._id, { outcome: "refunded", providerRefundId: "rf-manual" });
    expect(resolved.status).toBe("settled");
    expect(await balanceOf(ctx.a.user._id)).toBe(3000);
    expect(mockRefund).toHaveBeenCalledTimes(1);
  });

  it("the cron dead-letters a Flutterwave payout stuck mid-call without calling Flutterwave", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    await Refund.updateOne(
      { _id: request._id },
      { $set: { status: "processing", processingStartedAt: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    await svc.recoverRefunds();

    expect((await Refund.findById(request._id)).status).toBe("needs_review");
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it("the cron retries booking, then dead-letters after repeated failures", async () => {
    const ctx = await paidOrder();
    const request = await requestRice(ctx);
    await Transaction.deleteMany({ reference: `Payment-${ctx.order._id}` }); // booking will fail
    await Refund.updateOne(
      { _id: request._id },
      { $set: { status: "provider_succeeded", providerRefundId: "rf-x" } },
    );

    for (let i = 0; i < 4; i++) await svc.settleRefund(request._id);
    expect(await Refund.findById(request._id)).toMatchObject({ status: "provider_succeeded", attempts: 4 });
    await svc.settleRefund(request._id);
    expect((await Refund.findById(request._id)).status).toBe("needs_review");
  });
});

describe("cancellation", () => {
  it("cancelling a paid order moves no money and leaves it Paid for the buyer to request", async () => {
    const ctx = await paidOrder();
    await transitionOrder({ orderId: ctx.order._id, toStatus: "cancelled", role: "seller" });

    const order = await Order.findById(ctx.order._id);
    expect(order.orderStatus).toBe("cancelled");
    expect(order.paymentStatus).toBe("Paid");
    expect(await Refund.countDocuments({ order: ctx.order._id })).toBe(0);
    expect(mockRefund).not.toHaveBeenCalled();

    await expect(requestRice(ctx, { reason: "order_cancelled" })).resolves.toMatchObject({ status: "requested" });
  });
});

describe("HTTP endpoints", () => {
  it("runs buyer request → seller reject → buyer escalate → admin approve over the API", async () => {
    const ctx = await paidOrder();
    const buyerToken = makeToken(ctx.buyer._id);
    const sellerToken = makeToken(ctx.a.user._id);
    const { user: adminUser } = await createTestUser({ role: ["admin"], activeRole: "admin" });
    const adminToken = makeToken(adminUser._id);
    mockRefund.mockResolvedValue(flwSuccess());

    const refundable = await request(app)
      .get(`/api/order/${ctx.order._id}/refundable`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(refundable.status).toBe(200);
    expect(refundable.body.data.stores).toHaveLength(2);

    const created = await request(app)
      .post(`/api/order/${ctx.order._id}/refund-requests`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ storeId: ctx.a.store._id, items: [{ productId: ctx.rice._id, quantity: 1 }], reason: "damaged" });
    expect(created.status).toBe(201);
    const id = created.body.data.refund.id;
    expect(created.body.data.refund).toMatchObject({ amount: 3300, statusLabel: "Awaiting seller" });
    expect(created.body.data.refund.vendorAmount).toBeUndefined(); // seller/admin only

    const sellerList = await request(app)
      .get("/api/store/refund-requests?status=requested")
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(sellerList.status).toBe(200);
    expect(sellerList.body.data.counts.awaitingResponse).toBe(1);
    expect(sellerList.body.data.refunds[0]).toMatchObject({ id, vendorAmount: 3000, allowedActions: ["approve", "reject"] });

    // The other seller cannot see or answer it.
    const otherSeller = await request(app)
      .post(`/api/store/refund-requests/${id}/approve`)
      .set("Authorization", `Bearer ${makeToken(ctx.b.user._id)}`);
    expect(otherSeller.status).toBe(404);

    const rejected = await request(app)
      .post(`/api/store/refund-requests/${id}/reject`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ reason: "Delivered sealed" });
    expect(rejected.status).toBe(200);

    const escalated = await request(app)
      .post(`/api/order/refund-requests/${id}/escalate`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ note: "It was not" });
    expect(escalated.status).toBe(200);
    expect(escalated.body.data.refund.statusLabel).toBe("Under review by WigoMarket");

    const queue = await request(app)
      .get("/api/admin/refund-requests?status=escalated")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(queue.status).toBe(200);
    expect(queue.body.data.counts.escalated).toBe(1);

    const decided = await request(app)
      .post(`/api/admin/refund-requests/${id}/decision`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "approve" });
    expect(decided.status).toBe(200);
    expect(decided.body.data.refund).toMatchObject({ status: "settled", approvedBy: "admin" });

    const mine = await request(app)
      .get(`/api/order/refund-requests?orderId=${ctx.order._id}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(mine.body.data.refunds[0]).toMatchObject({ id, statusLabel: "Refunded" });
  });

  it("maps refund errors to their status codes", async () => {
    const ctx = await paidOrder();
    const res = await request(app)
      .post(`/api/order/${ctx.order._id}/refund-requests`)
      .set("Authorization", `Bearer ${makeToken(ctx.buyer._id)}`)
      .send({ reason: "because" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid reason/);
  });
});

describe("Flutterwave refund response handling", () => {
  it("only trusts an explicit success with a refund id", async () => {
    const o = async (body) => {
      mockRefund.mockResolvedValueOnce(body);
      return (await flutterwave.refund({ providerTransactionId: "1", amount: 100 })).outcome;
    };
    expect(await o({ status: "success", data: { id: 7, status: "completed" } })).toBe("succeeded");
    expect(await o({ status: "success", data: { id: 7, status: "failed" } })).toBe("rejected");
    expect(await o({ status: "error", message: "nope" })).toBe("rejected");
    expect(await o({ status: "success", data: {} })).toBe("unknown");
    expect(await o(undefined)).toBe("unknown");
  });
});
