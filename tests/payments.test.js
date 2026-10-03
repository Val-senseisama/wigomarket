/**
 * Payment provider layer (services/payments) and the shared settlement path.
 *
 *   - Monnify adapter against a mocked HTTP layer: auth, status mapping,
 *     webhook signatures, refunds and payouts.
 *   - settleOrderPayment: exactly-once under a verify/webhook race, and the
 *     reference / amount / duplicate-charge guards.
 *   - The HTTP endpoints (initialize, verify, webhook) and the pending-payment
 *     cron, with the adapter's network methods stubbed.
 *   - Monnify refunds: IN_PROGRESS stays processing and the cron follows it up.
 */

// Stands in for Monnify's API: (method, path, body) → { status, data } or throw.
const mockHttp = jest.fn();
jest.mock("axios", () =>
  jest.fn(async (req) => {
    const url = new URL(req.url);
    const res = await mockHttp(req.method.toUpperCase(), url.pathname + url.search, req.data, req.headers);
    if (res.status >= 400) {
      const err = new Error(`Request failed with status code ${res.status}`);
      err.response = res;
      throw err;
    }
    return res;
  }),
);
jest.mock("../services/alertService", () => ({
  notifyAdmins: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/firebaseNotificationService", () => ({
  sendNotificationToUser: jest.fn().mockResolvedValue({}),
}));
jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));

const crypto = require("crypto");
const request = require("supertest");
const app = require("../app");
const { makeToken, createTestUser, getOrCreateCategory } = require("./helpers");
const appConfig = require("../config/appConfig");
const monnify = require("../services/payments/monnifyProvider");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Wallet = require("../models/walletModel");
const Refund = require("../models/refundModel");
const Transaction = require("../models/transactionModel");
const { notifyAdmins } = require("../services/alertService");
const { settleOrderPayment, SettlementError } = require("../services/orderPaymentSettlement");
const { runPendingPaymentCheck } = require("../services/pendingPaymentCron");
const { processWebhookEvent } = require("../services/webhookPaymentProcessor");
const processWebhook = (provider, event) => processWebhookEvent({ provider, event, sourceIp: "test" });
const refunds = require("../services/orderRefundService");

const SECRET = "monnify-test-secret";
const ok = (responseBody) => ({ status: 200, data: { requestSuccessful: true, responseMessage: "success", responseCode: "0", responseBody } });
const refused = (status, responseMessage) => ({ status, data: { requestSuccessful: false, responseMessage, responseCode: "99" } });
const ACTOR = { userId: null, role: "system", ip: "test" };

let seq = 0;

beforeAll(() => {
  Object.assign(appConfig.payment.monnify, {
    apiKey: "MK_TEST_key",
    secretKey: SECRET,
    contractCode: "1234567890",
    walletAccountNumber: "9876543210",
    environment: "LIVE",
  });
  appConfig.payment.provider = "monnify";
});

beforeEach(() => {
  monnify.resetToken();
  mockHttp.mockReset();
  notifyAdmins.mockClear();
  jest.restoreAllMocks();
});

// Login always succeeds; `routes` answers everything else.
const monnifyApi = (routes) =>
  mockHttp.mockImplementation(async (method, path, body) => {
    if (method === "POST" && path === "/api/v1/auth/login") return ok({ accessToken: "tok", expiresIn: 3600 });
    for (const [match, handler] of routes) {
      if (path.startsWith(match)) return handler(method, path, body);
    }
    throw new Error(`Unexpected Monnify call ${method} ${path}`);
  });

// ── Fixtures ─────────────────────────────────────────────────────────────────

const makeSeller = async () => {
  const { user } = await createTestUser({ role: ["seller"], activeRole: "seller" });
  const n = `${Date.now()}${++seq}`;
  const store = await Store.create({
    name: `Pay Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    owner: user._id,
    address: "1 Test Street",
    email: `pay-${n}@example.com`,
    ownerNIN: `${n.slice(-11)}`,
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
  return { user, store };
};

/** One-store order: 2 × ₦3,300 (seller gets ₦3,000 each). */
const unpaidOrder = async (paymentIntent = {}) => {
  const { user: buyer, token } = await createTestUser();
  const seller = await makeSeller();
  const category = await getOrCreateCategory();
  const n = `${Date.now()}${++seq}`;
  const product = await Product.create({
    title: `Pay Product ${n}`,
    slug: `pay-product-${n}`,
    description: "A product used by the payment tests",
    price: 3000,
    listedPrice: 3300,
    quantity: 8,
    store: seller.store._id,
    category: category._id,
  });
  const order = await Order.create({
    products: [{ product: product._id, count: 2, store: seller.store._id, price: 3000, listedPrice: 3300 }],
    orderedBy: buyer._id,
    deliveryMethod: "self_delivery",
    deliveryAddress: "1 Test Road, Lagos",
    paymentStatus: "Unpaid",
    paymentIntent: { id: `wm${n}`, amount: 6600, currency: "NGN", status: "Unpaid", ...paymentIntent },
  });
  return { order, buyer, token, seller, product };
};

/** An order whose checkout was opened with Monnify under `reference`. */
const checkedOutOrder = async () => {
  const ctx = await unpaidOrder();
  const reference = `${ctx.order.paymentIntent.id}-abcd1234`;
  await Order.updateOne(
    { _id: ctx.order._id },
    {
      $set: { "paymentIntent.provider": "monnify", "paymentIntent.reference": reference, "paymentIntent.initializedAt": new Date() },
      $push: { "paymentIntent.references": reference },
    },
  );
  return { ...ctx, reference, order: await Order.findById(ctx.order._id) };
};

const charge = (reference, overrides = {}) => ({
  status: "succeeded",
  reference,
  providerTransactionId: `MNFY|20|${Date.now()}|${++seq}`,
  amount: 6600,
  currency: "NGN",
  providerStatus: "PAID",
  ...overrides,
});

const balanceOf = async (userId) => (await Wallet.findOne({ user: userId }))?.balance ?? 0;

const waitFor = async (fn, ms = 3000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

// ── Monnify adapter ──────────────────────────────────────────────────────────

describe("Monnify adapter", () => {
  it("logs in once and reuses the bearer token", async () => {
    monnifyApi([["/api/v1/banks", () => ok([{ code: "058", name: "GTBank", ussdTemplate: "*737#" }])]]);

    await monnify.listBanks();
    const banks = await monnify.listBanks();

    expect(banks).toEqual([{ code: "058", name: "GTBank" }]);
    const logins = mockHttp.mock.calls.filter(([, path]) => path === "/api/v1/auth/login");
    expect(logins).toHaveLength(1);
    const basic = Buffer.from(`MK_TEST_key:${SECRET}`).toString("base64");
    expect(logins[0][3].Authorization).toBe(`Basic ${basic}`);
    expect(mockHttp.mock.calls.at(-1)[3].Authorization).toBe("Bearer tok");
  });

  it("initialises checkout with our reference and the contract code", async () => {
    monnifyApi([
      ["/api/v1/merchant/transactions/init-transaction", () =>
        ok({ transactionReference: "MNFY|1", paymentReference: "ref-1", checkoutUrl: "https://sandbox.sdk.monnify.com/checkout/MNFY|1" })],
    ]);

    const out = await monnify.initializeCheckout({
      reference: "ref-1",
      amount: 6600,
      customer: { name: "Ada", email: "ada@example.com" },
      description: "Order #1",
      redirectUrl: "https://app.example.com/payment/callback",
    });

    expect(out).toEqual({ checkoutUrl: "https://sandbox.sdk.monnify.com/checkout/MNFY|1", providerReference: "MNFY|1" });
    const body = mockHttp.mock.calls.at(-1)[2];
    expect(body).toMatchObject({ paymentReference: "ref-1", amount: 6600, contractCode: "1234567890", currencyCode: "NGN" });
  });

  it("maps payment statuses and treats an unknown reference as not paid yet", async () => {
    const status = { value: "PAID" };
    monnifyApi([
      ["/api/v2/merchant/transactions/query?paymentReference=missing", () => refused(400, "Transaction not found")],
      ["/api/v2/merchant/transactions/query", () =>
        ok({ paymentReference: "ref-1", transactionReference: "MNFY|1", amountPaid: "6600.00", paymentStatus: status.value, currency: "NGN" })],
    ]);

    await expect(monnify.verifyCharge({ reference: "ref-1" })).resolves.toEqual({
      status: "succeeded",
      reference: "ref-1",
      providerTransactionId: "MNFY|1",
      amount: 6600,
      currency: "NGN",
      providerStatus: "PAID",
    });
    status.value = "PENDING";
    expect((await monnify.verifyCharge({ reference: "ref-1" })).status).toBe("pending");
    status.value = "EXPIRED";
    expect((await monnify.verifyCharge({ reference: "ref-1" })).status).toBe("failed");
    expect((await monnify.verifyCharge({ reference: "missing" })).status).toBe("pending");
  });

  it("surfaces bad credentials instead of reading them as 'not paid'", async () => {
    mockHttp.mockResolvedValue(refused(401, "Invalid credentials"));
    await expect(monnify.verifyCharge({ reference: "ref-1" })).rejects.toThrow(/Invalid credentials/);
  });

  it("checks the webhook signature over the raw body", () => {
    const rawBody = Buffer.from(JSON.stringify({ eventType: "SUCCESSFUL_TRANSACTION", eventData: { paymentReference: "r" } }));
    const signature = crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex");

    expect(monnify.verifyWebhookSignature({ headers: { "monnify-signature": signature }, rawBody })).toBe(true);
    const tampered = Buffer.from(rawBody.toString().replace('"r"', '"x"'));
    expect(monnify.verifyWebhookSignature({ headers: { "monnify-signature": signature }, rawBody: tampered })).toBe(false);
    expect(monnify.verifyWebhookSignature({ headers: {}, rawBody })).toBe(false);

    // Sandbox webhooks are unsigned; safe only because every event is re-verified.
    appConfig.payment.monnify.environment = "SANDBOX";
    try {
      expect(monnify.verifyWebhookSignature({ headers: {}, rawBody })).toBe(true);
    } finally {
      appConfig.payment.monnify.environment = "LIVE";
    }
  });

  it("only acts on successful-transaction webhooks", () => {
    expect(
      monnify.parseWebhook({ eventType: "SUCCESSFUL_TRANSACTION", eventData: { paymentReference: "r", transactionReference: "MNFY|1" } }),
    ).toEqual({ type: "charge.succeeded", reference: "r", providerTransactionId: "MNFY|1" });
    expect(monnify.parseWebhook({ eventType: "SUCCESSFUL_DISBURSEMENT", eventData: {} })).toBeNull();
    expect(monnify.parseWebhook({ eventType: "SUCCESSFUL_REFUND", eventData: { refundReference: "RF-1" } })).toBeNull();
  });

  it("turns disbursement webhooks into transfer updates", () => {
    expect(
      monnify.parseWebhook({ eventType: "REVERSED_DISBURSEMENT", eventData: { reference: "WD_1", status: "REVERSED" } }),
    ).toEqual({ type: "transfer.updated", reference: "WD_1", providerTransferId: null, providerStatus: "REVERSED" });
  });

  it("looks a payout up by our reference, and reports one it never received as not_found", async () => {
    const answer = { value: null };
    monnifyApi([["/api/v2/disbursements/single/summary", () => answer.value()]]);

    answer.value = () => ok({ reference: "WD_1", status: "SUCCESS", amount: 5000 });
    expect(await monnify.getTransferStatus({ reference: "WD_1" })).toMatchObject({ outcome: "succeeded", providerStatus: "SUCCESS" });
    answer.value = () => ok({ reference: "WD_1", status: "REVERSED" });
    expect((await monnify.getTransferStatus({ reference: "WD_1" })).outcome).toBe("failed");
    answer.value = () => refused(404, "Could not find transfer with reference WD_1");
    expect((await monnify.getTransferStatus({ reference: "WD_1" })).outcome).toBe("not_found");
    answer.value = () => {
      throw new Error("ETIMEDOUT");
    };
    await expect(monnify.getTransferStatus({ reference: "WD_1" })).rejects.toThrow(/ETIMEDOUT/);
    expect(mockHttp.mock.calls.at(-1)[1]).toBe("/api/v2/disbursements/single/summary?reference=WD_1");
  });

  it("classifies refund answers, and never calls a timeout a rejection", async () => {
    const answer = { value: null };
    monnifyApi([["/api/v1/refunds/initiate-refund", () => answer.value()]]);
    const send = () => monnify.refund({ providerTransactionId: "MNFY|1", amount: 3300, refundReference: "RF-1", reason: "Item arrived damaged" });

    answer.value = () => ok({ refundReference: "RF-1", refundStatus: "IN_PROGRESS" });
    expect(await send()).toMatchObject({ outcome: "pending", providerRefundId: "RF-1", providerStatus: "IN_PROGRESS" });
    answer.value = () => ok({ refundReference: "RF-1", refundStatus: "COMPLETED" });
    expect((await send()).outcome).toBe("succeeded");
    answer.value = () => refused(400, "Refund amount exceeds transaction amount");
    expect(await send()).toMatchObject({ outcome: "rejected", message: "Refund amount exceeds transaction amount" });
    answer.value = () => {
      throw new Error("ETIMEDOUT");
    };
    expect((await send()).outcome).toBe("unknown");

    const body = mockHttp.mock.calls.find(([, path]) => path === "/api/v1/refunds/initiate-refund")[2];
    expect(body).toMatchObject({ transactionReference: "MNFY|1", refundReference: "RF-1", refundAmount: 3300 });
    expect(body.customerNote.length).toBeLessThanOrEqual(16);
  });

  it("pays out from the configured wallet, and keeps a transfer held for OTP pending", async () => {
    const status = { value: "SUCCESS" };
    monnifyApi([["/api/v2/disbursements/single", (m, p, body) => ok({ reference: body.reference, status: status.value })]]);
    const send = () =>
      monnify.transfer({ amount: 5000, reference: "WD_1", narration: "Withdrawal", bankCode: "058", accountNumber: "0123456789", accountName: "Ada" });

    expect(await send()).toMatchObject({ outcome: "succeeded", reference: "WD_1", providerStatus: "SUCCESS" });
    expect(mockHttp.mock.calls.at(-1)[2]).toMatchObject({ sourceAccountNumber: "9876543210", destinationBankCode: "058" });
    // The transfer exists and can still be authorised, so it must not be
    // treated as failed (which would refund the wallet and risk paying twice).
    status.value = "PENDING_AUTHORIZATION";
    expect(await send()).toMatchObject({ outcome: "pending", message: expect.stringMatching(/OTP/) });
    status.value = "FAILED";
    expect((await send()).outcome).toBe("failed");
  });
});

// ── Settlement ───────────────────────────────────────────────────────────────

describe("settleOrderPayment", () => {
  it("books a charge exactly once when the verify endpoint races the webhook", async () => {
    const ctx = await checkedOutOrder();
    const paid = charge(ctx.reference);

    const results = await Promise.all([
      settleOrderPayment({ orderId: ctx.order._id, provider: "monnify", charge: paid, source: "verify", actor: ACTOR }),
      settleOrderPayment({ orderId: ctx.order._id, provider: "monnify", charge: paid, source: "webhook", actor: ACTOR }),
    ]);

    expect(results.map((r) => r.result).sort()).toEqual(["already_paid", "settled"]);
    expect(await Transaction.countDocuments({ reference: `Payment-${ctx.order._id}` })).toBe(1);
    expect(await balanceOf(ctx.seller.user._id)).toBe(6000);
    const order = await Order.findById(ctx.order._id);
    expect(order.paymentStatus).toBe("Paid");
    expect(order.paymentIntent).toMatchObject({ provider: "monnify", providerTransactionId: paid.providerTransactionId });
    const tx = await Transaction.findOne({ reference: `Payment-${ctx.order._id}` });
    expect(tx.metadata).toMatchObject({ paymentMethod: "monnify", externalEventId: `monnify:charge:${paid.providerTransactionId}` });
  });

  it("refuses a charge made under another order's reference", async () => {
    const ctx = await checkedOutOrder();
    const other = await checkedOutOrder();

    await expect(
      settleOrderPayment({ orderId: ctx.order._id, provider: "monnify", charge: charge(other.reference), source: "verify", actor: ACTOR }),
    ).rejects.toMatchObject({ code: "reference_mismatch" });
    expect((await Order.findById(ctx.order._id)).paymentStatus).toBe("Unpaid");
    expect(await balanceOf(ctx.seller.user._id)).toBe(0);
    expect(notifyAdmins).toHaveBeenCalled();
  });

  it("refuses an underpaid charge and alerts admins", async () => {
    const ctx = await checkedOutOrder();

    const settling = settleOrderPayment({
      orderId: ctx.order._id,
      provider: "monnify",
      charge: charge(ctx.reference, { amount: 66 }),
      source: "webhook",
      actor: ACTOR,
    });
    await expect(settling).rejects.toBeInstanceOf(SettlementError);
    await expect(settling).rejects.toMatchObject({ code: "amount_mismatch" });
    expect((await Order.findById(ctx.order._id)).paymentStatus).toBe("Unpaid");
    expect(notifyAdmins).toHaveBeenCalledWith("Card payment could not be booked", expect.any(String), expect.any(Object));
  });

  it("flags a second, different charge for an already-paid order", async () => {
    const ctx = await checkedOutOrder();
    await settleOrderPayment({ orderId: ctx.order._id, provider: "monnify", charge: charge(ctx.reference), source: "webhook", actor: ACTOR });

    const second = await settleOrderPayment({
      orderId: ctx.order._id,
      provider: "monnify",
      charge: charge(ctx.reference),
      source: "webhook",
      actor: ACTOR,
    });

    expect(second.result).toBe("already_paid");
    expect(await balanceOf(ctx.seller.user._id)).toBe(6000);
    expect(notifyAdmins).toHaveBeenCalledWith("Buyer charged twice for one order", expect.any(String), expect.any(Object));
  });
});

// ── HTTP endpoints ───────────────────────────────────────────────────────────

describe("payment endpoints", () => {
  it("initialize opens a Monnify checkout under a fresh reference recorded on the order", async () => {
    const ctx = await unpaidOrder();
    const init = jest
      .spyOn(monnify, "initializeCheckout")
      .mockResolvedValue({ checkoutUrl: "https://checkout.example/1", providerReference: "MNFY|1" });

    const res = await request(app)
      .post("/api/payment/initialize")
      .set("Authorization", `Bearer ${ctx.token}`)
      .send({ orderId: ctx.order._id });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ payment_url: "https://checkout.example/1", provider: "monnify", amount: 6600 });
    const { reference } = res.body.data;
    expect(reference).toMatch(new RegExp(`^${ctx.order.paymentIntent.id}-[0-9a-f]{8}$`));
    expect(init).toHaveBeenCalledWith(expect.objectContaining({ reference, amount: 6600 }));

    const order = await Order.findById(ctx.order._id);
    expect(order.paymentIntent).toMatchObject({ provider: "monnify", reference, references: [reference], providerReference: "MNFY|1" });
    // Buyers have no wallet; checkout must not create one.
    expect(await Wallet.findOne({ user: ctx.buyer._id })).toBeNull();
  });

  it("initialize returns 502 when the provider is down, keeping the reference for recovery", async () => {
    const ctx = await unpaidOrder();
    jest.spyOn(monnify, "initializeCheckout").mockRejectedValue(new Error("ECONNRESET"));

    const res = await request(app)
      .post("/api/payment/initialize")
      .set("Authorization", `Bearer ${ctx.token}`)
      .send({ orderId: ctx.order._id });

    expect(res.status).toBe(502);
    expect((await Order.findById(ctx.order._id)).paymentIntent.references).toHaveLength(1);
  });

  it("verify books a charge Monnify confirms, by the order's own reference", async () => {
    const ctx = await checkedOutOrder();
    const verify = jest.spyOn(monnify, "verifyCharge").mockImplementation(async ({ reference }) => charge(reference));

    const res = await request(app)
      .post("/api/payment/verify")
      .send({ orderId: ctx.order._id, transaction_id: "something-the-client-made-up" });

    expect(res.status).toBe(200);
    expect(res.body.data.payment).toMatchObject({ provider: "monnify", reference: ctx.reference, amount: 6600 });
    expect(verify).toHaveBeenCalledWith({ reference: ctx.reference });
    expect((await Order.findById(ctx.order._id)).paymentStatus).toBe("Paid");

    const again = await request(app).post("/api/payment/verify").send({ orderId: ctx.order._id });
    expect(again.status).toBe(200);
    expect(again.body.message).toBe("Payment already processed");
    expect(await Transaction.countDocuments({ reference: `Payment-${ctx.order._id}` })).toBe(1);
  });

  it("verify reports a checkout that is not paid yet without failing the order", async () => {
    const ctx = await checkedOutOrder();
    jest.spyOn(monnify, "verifyCharge").mockImplementation(async ({ reference }) => charge(reference, { status: "pending", providerStatus: "PENDING" }));

    const res = await request(app).post("/api/payment/verify").send({ orderId: ctx.order._id });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ message: "Payment is not complete yet", data: { status: "pending", providerStatus: "PENDING" } });
    expect((await Order.findById(ctx.order._id)).paymentIntent.status).not.toBe("failed");
  });

  it("a signed Monnify webhook is re-verified, then books the payment", async () => {
    const ctx = await checkedOutOrder();
    const verify = jest.spyOn(monnify, "verifyCharge").mockImplementation(async ({ reference }) => charge(reference));
    const body = JSON.stringify({
      eventType: "SUCCESSFUL_TRANSACTION",
      eventData: { paymentReference: ctx.reference, transactionReference: "MNFY|hook", amountPaid: 6600, paymentStatus: "PAID" },
    });

    const res = await request(app)
      .post("/api/payment/webhook/monnify")
      .set("Content-Type", "application/json")
      .set("monnify-signature", crypto.createHmac("sha512", SECRET).update(body).digest("hex"))
      .send(body);

    expect(res.status).toBe(200);
    expect(await waitFor(async () => (await Order.findById(ctx.order._id)).paymentStatus === "Paid")).toBe(true);
    expect(verify).toHaveBeenCalledWith({ reference: ctx.reference });
    expect(await balanceOf(ctx.seller.user._id)).toBe(6000);
  });

  it("a webhook with a bad signature is rejected and books nothing", async () => {
    const ctx = await checkedOutOrder();
    const verify = jest.spyOn(monnify, "verifyCharge");

    const res = await request(app)
      .post("/api/payment/webhook/monnify")
      .set("monnify-signature", "0".repeat(128))
      .send({ eventType: "SUCCESSFUL_TRANSACTION", eventData: { paymentReference: ctx.reference } });

    expect(res.status).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect((await Order.findById(ctx.order._id)).paymentStatus).toBe("Unpaid");
  });

  it("an unknown provider in the webhook URL is a 404", async () => {
    const res = await request(app).post("/api/payment/webhook/paypal").send({});
    expect(res.status).toBe(404);
  });
});

// ── Cron ─────────────────────────────────────────────────────────────────────

describe("pending-payment cron", () => {
  it("books recent checkouts the provider now confirms, and leaves stale ones alone", async () => {
    const recent = await checkedOutOrder();
    const stale = await checkedOutOrder();
    await Order.updateOne({ _id: stale.order._id }, { $set: { "paymentIntent.initializedAt": new Date(Date.now() - 72 * 3600 * 1000) } });
    const verify = jest.spyOn(monnify, "verifyCharge").mockImplementation(async ({ reference }) => charge(reference));

    await runPendingPaymentCheck();

    expect((await Order.findById(recent.order._id)).toObject()).toMatchObject({ paymentStatus: "Paid", processingLock: false });
    expect((await Order.findById(stale.order._id)).paymentStatus).toBe("Unpaid");
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("releases the lock when the payment is still pending", async () => {
    const ctx = await checkedOutOrder();
    jest.spyOn(monnify, "verifyCharge").mockImplementation(async ({ reference }) => charge(reference, { status: "pending" }));

    await runPendingPaymentCheck();

    const order = await Order.findById(ctx.order._id);
    expect(order.paymentStatus).toBe("Unpaid");
    expect(order.processingLock).toBe(false);
  });
});

// ── Monnify refunds ──────────────────────────────────────────────────────────

describe("refunds through Monnify", () => {
  /** An order paid through Monnify, with a refund request awaiting the seller. */
  const refundRequest = async () => {
    const ctx = await checkedOutOrder();
    const paid = charge(ctx.reference);
    await settleOrderPayment({ orderId: ctx.order._id, provider: "monnify", charge: paid, source: "test", actor: ACTOR });
    const refund = await refunds.createRefundRequest({
      orderId: ctx.order._id,
      buyerId: ctx.buyer._id,
      storeId: ctx.seller.store._id,
      items: [{ productId: ctx.product._id, quantity: 1 }],
      reason: "damaged",
      details: "Torn bag",
    });
    return { ...ctx, paid, refund };
  };
  const ageProcessing = (id, ms) =>
    Refund.updateOne({ _id: id }, { $set: { processingStartedAt: new Date(Date.now() - ms) } });

  it("refunds through the provider that took the charge, under a persisted reference", async () => {
    const ctx = await refundRequest();
    expect(ctx.refund.provider).toBe("monnify");
    const send = jest
      .spyOn(monnify, "refund")
      .mockImplementation(async ({ refundReference }) => ({ outcome: "succeeded", providerRefundId: refundReference, providerStatus: "COMPLETED" }));

    const settled = await refunds.sellerApprove(ctx.refund._id, ctx.seller.store._id);

    expect(settled.status).toBe("settled");
    const [args] = send.mock.calls[0];
    expect(args).toMatchObject({ providerTransactionId: ctx.paid.providerTransactionId, amount: 3300 });
    expect(args.refundReference).toBe(settled.providerRefundReference);
    expect(await balanceOf(ctx.seller.user._id)).toBe(3000);
  });

  it("an IN_PROGRESS refund stays processing until the cron sees it complete", async () => {
    const ctx = await refundRequest();
    jest.spyOn(monnify, "refund").mockResolvedValue({ outcome: "pending", providerRefundId: "RF-x", providerStatus: "IN_PROGRESS" });
    const status = jest.spyOn(monnify, "getRefundStatus").mockResolvedValue({ outcome: "pending", providerStatus: "IN_PROGRESS" });

    const processing = await refunds.sellerApprove(ctx.refund._id, ctx.seller.store._id);
    expect(processing).toMatchObject({ status: "processing", providerStatus: "IN_PROGRESS" });
    expect(await balanceOf(ctx.seller.user._id)).toBe(6000); // nothing booked while in flight

    await ageProcessing(ctx.refund._id, 15 * 60 * 1000);
    await refunds.recoverRefunds();
    expect((await Refund.findById(ctx.refund._id)).status).toBe("processing");
    expect(status).toHaveBeenCalledWith({ refundReference: processing.providerRefundReference });

    status.mockResolvedValue({ outcome: "succeeded", providerRefundId: processing.providerRefundReference, providerStatus: "COMPLETED" });
    await refunds.recoverRefunds();
    expect((await Refund.findById(ctx.refund._id)).status).toBe("settled");
    expect(await balanceOf(ctx.seller.user._id)).toBe(3000);
    expect(monnify.refund).toHaveBeenCalledTimes(1); // followed up, never re-sent
  });

  it("a timed-out Monnify refund is followed up by reference instead of dead-lettered", async () => {
    const ctx = await refundRequest();
    jest.spyOn(monnify, "refund").mockResolvedValue({ outcome: "unknown", message: "ETIMEDOUT" });
    jest.spyOn(monnify, "getRefundStatus").mockResolvedValue({ outcome: "rejected", message: "Insufficient balance", providerStatus: "FAILED" });

    expect((await refunds.sellerApprove(ctx.refund._id, ctx.seller.store._id)).status).toBe("processing");
    await ageProcessing(ctx.refund._id, 15 * 60 * 1000);
    await refunds.recoverRefunds();

    expect(await Refund.findById(ctx.refund._id)).toMatchObject({ status: "failed", lastError: "Insufficient balance" });
    expect(await balanceOf(ctx.seller.user._id)).toBe(6000);
  });

  it("a refund Monnify has not finalised after 24h goes to manual review", async () => {
    const ctx = await refundRequest();
    jest.spyOn(monnify, "refund").mockResolvedValue({ outcome: "pending", providerStatus: "IN_PROGRESS" });
    jest.spyOn(monnify, "getRefundStatus").mockResolvedValue({ outcome: "pending", providerStatus: "IN_PROGRESS" });

    await refunds.sellerApprove(ctx.refund._id, ctx.seller.store._id);
    await ageProcessing(ctx.refund._id, 25 * 3600 * 1000);
    await refunds.recoverRefunds();

    expect((await Refund.findById(ctx.refund._id)).status).toBe("needs_review");
  });

  it("an admin retry after a rejection sends a new reference", async () => {
    const ctx = await refundRequest();
    const send = jest
      .spyOn(monnify, "refund")
      .mockResolvedValueOnce({ outcome: "rejected", message: "Insufficient balance" })
      .mockImplementationOnce(async ({ refundReference }) => ({ outcome: "succeeded", providerRefundId: refundReference }));

    expect((await refunds.sellerApprove(ctx.refund._id, ctx.seller.store._id)).status).toBe("failed");
    await new Promise((r) => setTimeout(r, 5)); // references are time-based
    expect((await refunds.resolveRefund(ctx.refund._id, { outcome: "retry" })).status).toBe("settled");

    const [first, second] = send.mock.calls.map(([a]) => a.refundReference);
    expect(first).not.toBe(second);
  });
});

// ── Withdrawal payouts ───────────────────────────────────────────────────────

describe("withdrawal payouts through Monnify", () => {
  const payoutService = require("../services/withdrawalPayoutService");
  const { recoverPayouts } = payoutService;

  /**
   * A seller wallet left with ₦1,000 after requesting a ₦5,000 withdrawal
   * (₦100 fee), as controllers/wallet/requestWithdrawal leaves it.
   */
  const pendingWithdrawal = async () => {
    const { user, token: userToken } = await createTestUser({ role: ["seller"], activeRole: "seller" });
    await Wallet.create({
      user: user._id,
      balance: 1000,
      bankAccounts: [{ accountName: "Ada Obi", accountNumber: "0123456789", bankName: "GTBank", bankCode: "058", phoneNumber: "2348000000000", isDefault: true }],
    });
    const transactionId = `WD_${Date.now()}_${++seq}`;
    await Transaction.create({
      transactionId,
      reference: `Withdrawal-${transactionId}`,
      type: "wallet_withdrawal",
      totalAmount: 5100, // amount + fee, as requestWithdrawal books it
      entries: [
        { account: "accounts_payable", userId: user._id, debit: 5000, credit: 0 },
        { account: "wallet_vendor", userId: user._id, debit: 0, credit: 5000 },
        { account: "bank_transfer_fees", userId: user._id, debit: 100, credit: 0 },
        { account: "wallet_vendor", userId: user._id, debit: 0, credit: 100 },
      ],
      relatedEntity: { type: "withdrawal" },
      status: "pending",
      metadata: { paymentMethod: "bank_transfer" },
    });
    const { user: admin, token } = await createTestUser({ role: ["admin"], activeRole: "admin" });
    return { user, userToken, admin, token, transactionId };
  };

  const approve = (ctx) =>
    request(app).post(`/api/admin/withdrawals/${ctx.transactionId}/process`).set("Authorization", `Bearer ${ctx.token}`).send({ action: "approve" });
  const withdrawal = (ctx) => Transaction.findOne({ transactionId: ctx.transactionId });

  /** Monnify answers the transfer with `sendStatus` and the requery with `queryStatus.value`. */
  const disbursements = (sendStatus, queryStatus = { value: sendStatus }) =>
    monnifyApi([
      ["/api/v2/disbursements/single/summary", (m, p) => ok({ reference: new URL(`http://x${p}`).searchParams.get("reference"), status: queryStatus.value })],
      ["/api/v2/disbursements/single", (m, p, body) => ok({ reference: body.reference, status: sendStatus })],
    ]);

  it("completes a withdrawal Monnify pays out at once", async () => {
    const ctx = await pendingWithdrawal();
    disbursements("SUCCESS");

    const res = await approve(ctx);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "completed", payoutStatus: "succeeded", providerReference: `WD_${ctx.transactionId}`, amount: 5000 });
    expect((await withdrawal(ctx)).status).toBe("completed");
    // The fee stays with us: the bank gets the requested amount.
    const sent = mockHttp.mock.calls.find(([m, p]) => m === "POST" && p === "/api/v2/disbursements/single")[2];
    expect(sent).toMatchObject({ amount: 5000, reference: `WD_${ctx.transactionId}`, destinationAccountNumber: "0123456789" });
  });

  it("a seller's withdrawal request is booked and an admin can pay it out", async () => {
    const { user, token } = await createTestUser({ role: ["seller"], activeRole: "seller" });
    await Wallet.create({
      user: user._id,
      balance: 6100,
      bankAccounts: [{ accountName: "Ada Obi", accountNumber: "0123456789", bankName: "GTBank", bankCode: "058", phoneNumber: "2348000000000", isDefault: true }],
    });
    expect((await request(app).post("/api/wallet/pin").set("Authorization", `Bearer ${token}`).send({ pin: "1234" })).status).toBe(201);

    const requested = await request(app).post("/api/wallet/withdraw").set("Authorization", `Bearer ${token}`).send({ amount: 5000, pin: "1234" });
    expect(requested.status).toBe(200);
    expect(await balanceOf(user._id)).toBe(1000); // ₦6,100 − ₦5,000 − ₦100 fee

    const { token: adminToken } = await createTestUser({ role: ["admin"], activeRole: "admin" });
    const list = await request(app).get("/api/admin/withdrawals/pending?limit=100").set("Authorization", `Bearer ${adminToken}`);
    const mine = list.body.data.withdrawals.find((w) => String(w.user?._id) === String(user._id));
    expect(mine).toMatchObject({ amount: 5000, fee: 100, totalDeduction: 5100 });

    disbursements("SUCCESS");
    const paid = await approve({ transactionId: mine.transactionId, token: adminToken });
    expect(paid.status).toBe(200);
    expect(paid.body.data).toMatchObject({ amount: 5000, status: "completed" });
  });

  it("never pays a bill payment out to a bank account", async () => {
    const ctx = await pendingWithdrawal();
    await Transaction.updateOne({ transactionId: ctx.transactionId }, { $set: { "relatedEntity.type": "payment" } });
    const transfer = jest.spyOn(monnify, "transfer");

    const list = await request(app).get("/api/admin/withdrawals/pending?limit=100").set("Authorization", `Bearer ${ctx.token}`);
    expect(list.body.data.withdrawals.map((w) => w.transactionId)).not.toContain(ctx.transactionId);
    expect((await approve(ctx)).status).toBe(404);
    expect(transfer).not.toHaveBeenCalled();
  });

  it("keeps a PENDING transfer in transit until the cron sees it succeed", async () => {
    const ctx = await pendingWithdrawal();
    const query = { value: "PENDING" };
    disbursements("PENDING", query);

    const res = await approve(ctx);
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ status: "pending", payoutStatus: "in_transit" });

    // In transit: neither listed for approval nor approvable/rejectable again.
    const list = await request(app).get("/api/admin/withdrawals/pending").set("Authorization", `Bearer ${ctx.token}`);
    expect(list.body.data.withdrawals.map((w) => w.transactionId)).not.toContain(ctx.transactionId);
    const reject = await request(app)
      .post(`/api/admin/withdrawals/${ctx.transactionId}/process`)
      .set("Authorization", `Bearer ${ctx.token}`)
      .send({ action: "reject" });
    expect(reject.status).toBe(409);

    await Transaction.updateOne({ transactionId: ctx.transactionId }, { $set: { "payout.initiatedAt": new Date(Date.now() - 5 * 60 * 1000) } });
    await recoverPayouts();
    expect((await withdrawal(ctx)).status).toBe("pending");

    query.value = "SUCCESS";
    await recoverPayouts();
    const done = await withdrawal(ctx);
    expect(done.status).toBe("completed");
    expect(done.payout.status).toBe("succeeded");
    expect(await balanceOf(ctx.user._id)).toBe(1000);
  });

  it("returns amount + fee to the wallet exactly once when a FAILED_DISBURSEMENT webhook arrives twice", async () => {
    const ctx = await pendingWithdrawal();
    disbursements("PENDING", { value: "FAILED" });
    await approve(ctx);

    const body = JSON.stringify({ eventType: "FAILED_DISBURSEMENT", eventData: { reference: `WD_${ctx.transactionId}`, status: "FAILED" } });
    const hook = () =>
      request(app)
        .post("/api/payment/webhook/monnify")
        .set("Content-Type", "application/json")
        .set("monnify-signature", crypto.createHmac("sha512", SECRET).update(body).digest("hex"))
        .send(body);
    expect((await hook()).status).toBe(200);
    expect((await hook()).status).toBe(200);

    expect(await waitFor(async () => (await withdrawal(ctx)).status === "failed")).toBe(true);
    await new Promise((r) => setTimeout(r, 200));
    expect(await balanceOf(ctx.user._id)).toBe(6100);
    expect(await Transaction.countDocuments({ reference: `Reversal-${ctx.transactionId}` })).toBe(1);
    expect(notifyAdmins).toHaveBeenCalledWith("Withdrawal payout failed", expect.any(String), expect.any(Object));
  });

  it("re-verifies a disbursement webhook instead of trusting it", async () => {
    const ctx = await pendingWithdrawal();
    disbursements("PENDING", { value: "PENDING" });
    await approve(ctx);

    // Claims failure, but Monnify still says PENDING: nothing is refunded.
    await processWebhook("monnify", { type: "transfer.updated", reference: `WD_${ctx.transactionId}`, providerStatus: "FAILED" });
    expect((await withdrawal(ctx)).payout.status).toBe("in_transit");
    expect(await balanceOf(ctx.user._id)).toBe(1000);
  });

  it("refunds a payout the bank reverses after it succeeded", async () => {
    const ctx = await pendingWithdrawal();
    disbursements("SUCCESS", { value: "REVERSED" });
    await approve(ctx);

    await processWebhook("monnify", { type: "transfer.updated", reference: `WD_${ctx.transactionId}`, providerStatus: "REVERSED" });

    const t = await withdrawal(ctx);
    expect(t.status).toBe("reversed");
    expect(t.payout.status).toBe("reversed");
    expect(await balanceOf(ctx.user._id)).toBe(6100);
  });

  it("a timed-out transfer stays in transit and is settled by asking, never by resending", async () => {
    const ctx = await pendingWithdrawal();
    const query = { value: "SUCCESS" };
    monnifyApi([
      ["/api/v2/disbursements/single/summary", () => ok({ reference: `WD_${ctx.transactionId}`, status: query.value })],
      [
        "/api/v2/disbursements/single",
        () => {
          throw new Error("ETIMEDOUT");
        },
      ],
    ]);

    const res = await approve(ctx);
    expect(res.status).toBe(202);
    expect((await withdrawal(ctx)).payout.status).toBe("in_transit");

    await Transaction.updateOne({ transactionId: ctx.transactionId }, { $set: { "payout.initiatedAt": new Date(Date.now() - 5 * 60 * 1000) } });
    await recoverPayouts();

    expect((await withdrawal(ctx)).status).toBe("completed");
    const sends = mockHttp.mock.calls.filter(([m, p]) => m === "POST" && p === "/api/v2/disbursements/single");
    expect(sends).toHaveLength(1);
  });

  it("a transfer Monnify refuses moves nothing, and a retry goes out under a new reference", async () => {
    const ctx = await pendingWithdrawal();
    const answer = { value: () => refused(400, "Insufficient balance in wallet") };
    monnifyApi([["/api/v2/disbursements/single", (m, p, body) => answer.value(body)]]);

    const first = await approve(ctx);
    expect(first.status).toBe(502);
    expect(first.body.message).toBe("Insufficient balance in wallet");
    const t = await withdrawal(ctx);
    expect(t.status).toBe("pending");
    expect(t.payout).toMatchObject({ status: "rejected", attempts: 1 });
    expect(await balanceOf(ctx.user._id)).toBe(1000);

    answer.value = (body) => ok({ reference: body.reference, status: "SUCCESS" });
    const second = await approve(ctx);
    expect(second.status).toBe(200);
    expect(second.body.data.providerReference).toBe(`WD_${ctx.transactionId}_R2`);
  });

  it("concurrent approvals send one transfer", async () => {
    const ctx = await pendingWithdrawal();
    disbursements("SUCCESS");

    const results = await Promise.all([approve(ctx), approve(ctx)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const sends = mockHttp.mock.calls.filter(([m, p]) => m === "POST" && p === "/api/v2/disbursements/single");
    expect(sends).toHaveLength(1);
  });

  it("alerts admins once about a payout in transit for a day", async () => {
    const ctx = await pendingWithdrawal();
    disbursements("PENDING_AUTHORIZATION");
    await approve(ctx);
    await Transaction.updateOne({ transactionId: ctx.transactionId }, { $set: { "payout.initiatedAt": new Date(Date.now() - 25 * 60 * 60 * 1000) } });

    await recoverPayouts();
    await recoverPayouts();

    const stuck = notifyAdmins.mock.calls.filter(([title, , meta]) => title === "Withdrawal payout stuck in transit" && meta.transactionId === ctx.transactionId);
    expect(stuck).toHaveLength(1);
    expect((await withdrawal(ctx)).payout.status).toBe("in_transit");
  });
});

// ── Withdrawal figures ───────────────────────────────────────────────────────

describe("withdrawal figures", () => {
  /** A seller with one ₦5,000 (+₦100 fee) withdrawal and one ₦2,000 bill payment. */
  const sellerWithWithdrawalAndBill = async () => {
    const { user, token } = await createTestUser({ role: ["seller", "dispatch"], activeRole: "seller" });
    await Wallet.create({ user: user._id, balance: 1000 });
    const transactionId = `WD_${Date.now()}_${++seq}`;
    await Transaction.create({
      transactionId,
      reference: `Withdrawal-${transactionId}`,
      type: "wallet_withdrawal",
      totalAmount: 5100,
      entries: [
        { account: "accounts_payable", userId: user._id, debit: 5000, credit: 0 },
        { account: "wallet_vendor", userId: user._id, debit: 0, credit: 5000 },
        { account: "bank_transfer_fees", userId: user._id, debit: 100, credit: 0 },
        { account: "wallet_vendor", userId: user._id, debit: 0, credit: 100 },
      ],
      relatedEntity: { type: "withdrawal" },
      status: "pending",
    });
    await Transaction.create({
      transactionId: `BILL_${Date.now()}_${++seq}`,
      reference: "BillPayment-x",
      type: "wallet_withdrawal",
      totalAmount: 2000,
      entries: [
        { account: "wallet_vendor", userId: user._id, debit: 2000, credit: 0 },
        { account: "operating_expenses", debit: 0, credit: 2000 },
      ],
      relatedEntity: { type: "payment" },
      status: "pending",
    });
    return { user, token, transactionId };
  };

  it("earnings overviews count the payout amount, not the fee or bill payments", async () => {
    const ctx = await sellerWithWithdrawalAndBill();

    const seller = await request(app).get("/api/wallet/earnings-overview").set("Authorization", `Bearer ${ctx.token}`);
    expect(seller.status).toBe(200);
    expect(seller.body.data.pending).toBe(5000);

    await require("../models/userModel").updateOne({ _id: ctx.user._id }, { $set: { activeRole: "dispatch" } });
    const rider = await request(app).get("/api/delivery-agent/earnings/overview").set("Authorization", `Bearer ${ctx.token}`);
    expect(rider.status).toBe(200);
    expect(rider.body.data.pendingPayout).toBe(5000);
  });

  it("history lists withdrawals only, with amount, fee and total deduction", async () => {
    const ctx = await sellerWithWithdrawalAndBill();

    const res = await request(app).get("/api/wallet/withdrawals").set("Authorization", `Bearer ${ctx.token}`);

    expect(res.body.data.withdrawals).toHaveLength(1);
    expect(res.body.data.withdrawals[0]).toMatchObject({ transactionId: ctx.transactionId, amount: 5000, fee: 100, totalDeduction: 5100 });
  });

  it("admin overview and stats split amount from fee and in-transit from awaiting", async () => {
    await Transaction.deleteMany({ type: "wallet_withdrawal" });
    await sellerWithWithdrawalAndBill();
    const b = await sellerWithWithdrawalAndBill();
    await Transaction.updateOne({ transactionId: b.transactionId }, { $set: { "payout.status": "in_transit" } });
    const { token } = await createTestUser({ role: ["admin"], activeRole: "admin" });

    const overview = await request(app).get("/api/admin/overview").set("Authorization", `Bearer ${token}`);
    expect(overview.body.data.withdrawals).toEqual({ pending: 1, pendingAmount: 5000, inTransit: 1, inTransitAmount: 5000 });

    const stats = await request(app).get("/api/admin/withdrawals/stats").set("Authorization", `Bearer ${token}`);
    expect(stats.body.data.totals).toEqual({ totalCount: 2, totalAmount: 10000, totalFees: 200, totalDeduction: 10200 });
    expect(stats.body.data.statusBreakdown).toEqual([{ _id: "pending", count: 2, totalAmount: 10000, totalFees: 200, totalDeduction: 10200 }]);
  });
});
