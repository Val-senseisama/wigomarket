jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const sendEmail = require("../controllers/emailController");
const User = require("../models/userModel");
const Token = require("../models/tokensModel");
const Order = require("../models/orderModel");
const Wallet = require("../models/walletModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const { createTestUser, createTestSeller, createTestProduct } = require("./helpers");

const SECRETS = ["password", "refreshToken", "passwordRefreshToken", "passwordResetToken"];

const orderFor = (buyerId, product, orderStatus) =>
  Order.create({
    orderedBy: buyerId,
    products: [{ product: product._id, count: 1, price: 1000, store: product.store }],
    paymentIntent: { method: "card", amount: 1000, status: "success" },
    deliveryAddress: "1 Test Street, Lagos",
    deliveryMethod: "delivery_agent",
    orderStatus,
    totalAmount: 1000,
  });

beforeEach(() => sendEmail.mockClear());

describe("PUT /api/user/edit-user", () => {
  it("updates only the fields sent and never returns secrets", async () => {
    const { user, token } = await createTestUser({
      firstname: "Ada",
      lastname: "Obi",
      refreshToken: "rt-secret",
    });

    const res = await request(app)
      .put("/api/user/edit-user")
      .set("Authorization", `Bearer ${token}`)
      .send({ nickname: "Dee" });

    expect(res.status).toBe(200);
    expect(res.body.nickname).toBe("Dee");
    expect(res.body.firstname).toBe("Ada");
    expect(res.body.email).toBe(user.email);
    expect(res.body.emailChangePending).toBe(false);
    for (const field of SECRETS) expect(res.body).not.toHaveProperty(field);
  });

  it("rejects an empty update and invalid fields", async () => {
    const { token } = await createTestUser();
    const auth = { Authorization: `Bearer ${token}` };

    const empty = await request(app).put("/api/user/edit-user").set(auth).send({});
    expect(empty.status).toBe(400);

    const blank = await request(app).put("/api/user/edit-user").set(auth).send({ firstname: "  " });
    expect(blank.status).toBe(400);
  });

  it("ignores fields a user must not set on themselves", async () => {
    const { user, token } = await createTestUser();
    await request(app)
      .put("/api/user/edit-user")
      .set("Authorization", `Bearer ${token}`)
      .send({ nickname: "x", role: ["admin"], status: "blocked" });

    const fresh = await User.findById(user._id).lean();
    expect(fresh.role).toEqual(["buyer"]);
    expect(fresh.status).toBe("active");
  });

  it("rejects a mobile number that belongs to someone else", async () => {
    const { user: other } = await createTestUser();
    const { token } = await createTestUser();
    const res = await request(app)
      .put("/api/user/edit-user")
      .set("Authorization", `Bearer ${token}`)
      .send({ mobile: other.mobile });
    expect(res.status).toBe(400);
  });

  it("holds a new email as pending until the code is verified", async () => {
    const { user, token } = await createTestUser();
    const auth = { Authorization: `Bearer ${token}` };

    const res = await request(app).put("/api/user/edit-user").set(auth).send({ email: "New@Example.com" });
    expect(res.status).toBe(200);
    expect(res.body.emailChangePending).toBe(true);
    expect(res.body.email).toBe(user.email);
    expect(res.body.pendingEmail).toBe("new@example.com");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "new@example.com" }), true);

    const wrong = await request(app).post("/api/user/verify-email-change").set(auth).send({ code: "nope" });
    expect(wrong.status).toBe(400);
    expect((await User.findById(user._id)).email).toBe(user.email);

    const { code } = await Token.findOne({ email: "new@example.com" });
    const ok = await request(app).post("/api/user/verify-email-change").set(auth).send({ code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe("new@example.com");

    const fresh = await User.findById(user._id).lean();
    expect(fresh.email).toBe("new@example.com");
    expect(fresh.pendingEmail).toBeUndefined();
    expect(await Token.exists({ email: "new@example.com" })).toBeNull();
  });

  it("rejects an email already used by another account, case-insensitively", async () => {
    const { user: other } = await createTestUser();
    const { token } = await createTestUser();
    const res = await request(app)
      .put("/api/user/edit-user")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: other.email.toUpperCase() });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("verify-email-change fails when nothing is pending", async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .post("/api/user/verify-email-change")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "123456" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/user/me", () => {
  const del = (token, body) =>
    request(app).delete("/api/user/me").set("Authorization", `Bearer ${token}`).send(body);

  it("requires the correct password", async () => {
    const { token } = await createTestUser();
    expect((await del(token, {})).status).toBe(401);
    expect((await del(token, { password: "wrong" })).status).toBe(401);
  });

  it("anonymises the account, frees email/mobile and ends every session", async () => {
    const { user, token, rawPassword } = await createTestUser({ refreshToken: "rt" });

    const res = await del(token, { password: rawPassword, reason: "bye" });
    expect(res.status).toBe(200);

    const fresh = await User.findById(user._id).lean();
    expect(fresh.status).toBe("deleted");
    expect(fresh.deletedAt).toBeTruthy();
    expect(fresh.email).not.toBe(user.email);
    expect(fresh.mobile).toBeUndefined();
    expect(fresh.refreshToken).toBeUndefined();
    expect(fresh.fullName).toBe("Deleted user");

    // The old token no longer works.
    const me = await request(app).get("/api/user/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(403);

    // The old password does not log in, and the email/mobile can be reused.
    const login = await request(app).post("/api/user/login").send({ email: user.email, password: rawPassword });
    expect(login.status).not.toBe(200);
    await expect(createTestUser({ email: user.email, mobile: user.mobile })).resolves.toBeTruthy();
  });

  it("is refused while the user has an open order", async () => {
    const { user, token, rawPassword } = await createTestUser();
    const { store } = await createTestSeller();
    const product = await createTestProduct(store._id);
    await orderFor(user._id, product, "pending");

    const res = await del(token, { password: rawPassword });
    expect(res.status).toBe(409);
    expect(res.body.data.blockers.map((b) => b.code)).toEqual(["open_orders_as_buyer"]);
    expect((await User.findById(user._id)).status).toBe("active");
  });

  it("allows deletion once orders are finished", async () => {
    const { user, token, rawPassword } = await createTestUser();
    const { store } = await createTestSeller();
    const product = await createTestProduct(store._id);
    await orderFor(user._id, product, "delivered");
    await orderFor(user._id, product, "cancelled");

    expect((await del(token, { password: rawPassword })).status).toBe(200);
  });

  it("blocks a seller whose store has open orders", async () => {
    const { user: seller, token } = await createTestSeller();
    const store = await Store.findOne({ owner: seller._id });
    const product = await createTestProduct(store._id);
    const { user: buyer } = await createTestUser();
    await orderFor(buyer._id, product, "preparing");

    const res = await del(token, { password: "TestPass123!" });
    expect(res.status).toBe(409);
    expect(res.body.data.blockers.map((b) => b.code)).toContain("open_orders_as_seller");
  });

  it("blocks while the wallet holds money", async () => {
    const { user, token, rawPassword } = await createTestUser();
    await Wallet.create({ user: user._id, balance: 500 });

    const res = await del(token, { password: rawPassword });
    expect(res.status).toBe(409);
    expect(res.body.data.blockers.map((b) => b.code)).toEqual(["wallet_balance"]);
  });

  it("switches off a seller's store and products and closes an empty wallet", async () => {
    const { user: seller, token } = await createTestSeller();
    const store = await Store.findOne({ owner: seller._id });
    const product = await createTestProduct(store._id);
    await Wallet.create({ user: seller._id, balance: 0 });

    expect((await del(token, { password: "TestPass123!" })).status).toBe(200);

    expect((await Store.findById(store._id)).status).toBe("suspended");
    expect((await Product.findById(product._id)).status).toBe("hidden");
    expect((await Wallet.findOne({ user: seller._id })).status).toBe("closed");
  });
});

describe("Password hashing", () => {
  it("does not re-hash the password on unrelated saves", async () => {
    const { user, rawPassword } = await createTestUser();
    const doc = await User.findById(user._id);
    doc.nickname = "changed";
    await doc.save();
    await doc.save();

    const login = await request(app).post("/api/user/login").send({ email: user.email, password: rawPassword });
    expect(login.status).toBe(200);
  });

  it("still hashes a changed password", async () => {
    const { user } = await createTestUser();
    const doc = await User.findById(user._id);
    doc.password = "BrandNew123!";
    await doc.save();

    const fresh = await User.findById(user._id);
    expect(fresh.password).not.toBe("BrandNew123!");
    expect(await fresh.isPasswordMatched("BrandNew123!")).toBe(true);
  });

  it("allows a Google account without a password, which can never password-login", async () => {
    const user = await User.create({
      email: "google-only@example.com",
      firebaseUid: "firebase-uid-1",
      status: "active",
    });
    expect(user.password).toBeUndefined();
    expect(await user.isPasswordMatched("anything")).toBe(false);

    await expect(User.create({ email: "no-pass@example.com", status: "active" })).rejects.toThrow(/password/);
  });
});

describe("Login errors", () => {
  it("answers bad credentials with 401, not 500", async () => {
    const { user } = await createTestUser();
    const res = await request(app).post("/api/user/login").send({ email: user.email, password: "nope" });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("answers a malformed email with 400", async () => {
    const res = await request(app).post("/api/user/login").send({ email: "not-an-email", password: "x" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/delivery-agent/account", () => {
  it("uses the shared flow: needs the password, then anonymises instead of removing", async () => {
    const { user, token, rawPassword } = await createTestUser({ role: ["dispatch"], activeRole: "dispatch" });
    const del = (body) =>
      request(app).delete("/api/delivery-agent/account").set("Authorization", `Bearer ${token}`).send(body);

    expect((await del({})).status).toBe(401);
    expect((await del({ password: rawPassword })).status).toBe(200);

    const fresh = await User.findById(user._id).lean();
    expect(fresh).not.toBeNull();
    expect(fresh.status).toBe("deleted");
  });

  it("is refused while a delivery is in progress", async () => {
    const { user: rider, token, rawPassword } = await createTestUser({ role: ["dispatch"], activeRole: "dispatch" });
    const { user: buyer } = await createTestUser();
    const { store } = await createTestSeller();
    const product = await createTestProduct(store._id);
    const order = await orderFor(buyer._id, product, "inTransit");
    await Order.updateOne({ _id: order._id }, { deliveryAgent: rider._id });

    const res = await request(app)
      .delete("/api/delivery-agent/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ password: rawPassword });
    expect(res.status).toBe(409);
    expect(res.body.data.blockers.map((b) => b.code)).toEqual(["open_deliveries"]);
  });
});

describe("DELETE /api/user/delete/:id (admin)", () => {
  const admin = () => createTestUser({ role: ["admin"], activeRole: "admin" });

  it("anonymises the user and returns no user document", async () => {
    const { token } = await admin();
    const { user } = await createTestUser();

    const res = await request(app).delete(`/api/user/delete/${user._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ _id: String(user._id) });

    const fresh = await User.findById(user._id).lean();
    expect(fresh.status).toBe("deleted");
    expect(fresh.email).not.toBe(user.email);

    const again = await request(app).delete(`/api/user/delete/${user._id}`).set("Authorization", `Bearer ${token}`);
    expect(again.status).toBe(404);
  });

  it("is refused while the user has money in their wallet", async () => {
    const { token } = await admin();
    const { user } = await createTestUser();
    await Wallet.create({ user: user._id, balance: 100 });

    const res = await request(app).delete(`/api/user/delete/${user._id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
    expect((await User.findById(user._id)).status).toBe("active");
  });
});

describe("utils/redisKeys", () => {
  const redisClient = require("../config/redisClient");
  const { scanKeys, deleteByPatterns } = require("../utils/redisKeys");

  it("finds and deletes keys by pattern without touching others", async () => {
    const tag = `test-${Date.now()}`;
    await Promise.all([
      redisClient.set(`${tag}:a:1`, "x"),
      redisClient.set(`${tag}:a:2`, "x"),
      redisClient.set(`${tag}:b:1`, "x"),
    ]);

    expect((await scanKeys(`${tag}:a:*`)).sort()).toEqual([`${tag}:a:1`, `${tag}:a:2`]);
    const deleted = await deleteByPatterns([`${tag}:a:*`, `${tag}:a:1`]);
    expect(deleted.sort()).toEqual([`${tag}:a:1`, `${tag}:a:2`]);
    expect(await scanKeys(`${tag}:*`)).toEqual([`${tag}:b:1`]);

    await redisClient.del(`${tag}:b:1`);
  });
});
