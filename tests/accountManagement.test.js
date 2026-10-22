jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
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

// A token issued a minute ago. JWT iat has one-second resolution and a token
// from the same second as a password change is still accepted, so tests of
// sign-out need a token that is clearly older.
const olderToken = (userId) =>
  jwt.sign({ id: userId, iat: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });

const getMe = (token) => request(app).get("/api/user/me").set("Authorization", `Bearer ${token}`);

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

  it("resends the change code: new code, old one dead, expiry restarted, once a minute", async () => {
    const { token } = await createTestUser();
    const auth = { Authorization: `Bearer ${token}` };

    const none = await request(app).post("/api/user/resend-email-change-code").set(auth);
    expect(none.status).toBe(400);

    await request(app).put("/api/user/edit-user").set(auth).send({ email: "resend@example.com" });
    const tooSoon = await request(app).post("/api/user/resend-email-change-code").set(auth);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.retryAfter).toBeGreaterThan(0);

    // Pretend the first code went out 14 minutes ago.
    const old = new Date(Date.now() - 14 * 60 * 1000);
    await Token.updateOne({ email: "resend@example.com" }, { $set: { createdAt: old } });
    const { code: oldCode } = await Token.findOne({ email: "resend@example.com" });
    sendEmail.mockClear();

    const res = await request(app).post("/api/user/resend-email-change-code").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.pendingEmail).toBe("resend@example.com");
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "resend@example.com" }), true);

    const fresh = await Token.findOne({ email: "resend@example.com" });
    expect(fresh.createdAt.getTime()).toBeGreaterThan(Date.now() - 5000);

    if (fresh.code !== oldCode) {
      const stale = await request(app).post("/api/user/verify-email-change").set(auth).send({ code: oldCode });
      expect(stale.status).toBe(400);
    }
    const ok = await request(app).post("/api/user/verify-email-change").set(auth).send({ code: fresh.code });
    expect(ok.status).toBe(200);
  });

  it("restarts the code expiry when edit-user is called again with the same email", async () => {
    const { token } = await createTestUser();
    const auth = { Authorization: `Bearer ${token}` };
    await request(app).put("/api/user/edit-user").set(auth).send({ email: "again@example.com" });
    const old = new Date(Date.now() - 14 * 60 * 1000);
    await Token.updateOne({ email: "again@example.com" }, { $set: { createdAt: old } });

    await request(app).put("/api/user/edit-user").set(auth).send({ email: "again@example.com" });
    const token2 = await Token.findOne({ email: "again@example.com" });
    expect(token2.createdAt.getTime()).toBeGreaterThan(Date.now() - 5000);
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

describe("PUT /api/user/update-password", () => {
  const put = (token, body) =>
    request(app).put("/api/user/update-password").set("Authorization", `Bearer ${token}`).send(body);

  it("changes the password and returns a new token pair but no secrets", async () => {
    const { user, rawPassword } = await createTestUser({ refreshToken: "old-rt" });
    const token = olderToken(user._id);
    const otherDevice = olderToken(user._id);

    const res = await put(token, { currentPassword: rawPassword, newPassword: "BrandNew123!" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.tokenExpiresAt).toBeTruthy();
    expect(res.body).not.toHaveProperty("password");

    // Every older access token is signed out, the caller's own included;
    // the new one works.
    expect((await getMe(token)).status).toBe(401);
    expect((await getMe(otherDevice)).status).toBe(401);
    expect((await getMe(res.body.token)).status).toBe(200);

    const fresh = await User.findById(user._id);
    expect(await fresh.isPasswordMatched("BrandNew123!")).toBe(true);
    expect(fresh.refreshToken).toBe(res.body.refreshToken);
    expect(fresh.passwordChangedAt).toBeTruthy();

    // Other sessions can no longer refresh; the caller's new token can.
    const stale = await request(app).post("/api/user/refresh").send({ refreshToken: "old-rt" });
    expect(stale.status).toBe(403);
    const current = await request(app).post("/api/user/refresh").send({ refreshToken: res.body.refreshToken });
    expect(current.status).toBe(200);

    const oldLogin = await request(app).post("/api/user/login").send({ email: user.email, password: rawPassword });
    expect(oldLogin.status).toBe(401);
    const newLogin = await request(app).post("/api/user/login").send({ email: user.email, password: "BrandNew123!" });
    expect(newLogin.status).toBe(200);
  });

  it("requires the correct current password", async () => {
    const { user, token, rawPassword } = await createTestUser();
    expect((await put(token, { newPassword: "BrandNew123!" })).status).toBe(400);
    expect((await put(token, { currentPassword: "wrong", newPassword: "BrandNew123!" })).status).toBe(401);

    const fresh = await User.findById(user._id);
    expect(await fresh.isPasswordMatched(rawPassword)).toBe(true);
  });

  it("rejects a short or unchanged new password", async () => {
    const { token, rawPassword } = await createTestUser();
    expect((await put(token, { currentPassword: rawPassword, newPassword: "123" })).status).toBe(400);
    expect((await put(token, { currentPassword: rawPassword, newPassword: rawPassword })).status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).put("/api/user/update-password").send({ currentPassword: "a", newPassword: "bbbbbb" });
    expect(res.status).toBe(401);
  });
});

describe("Sign-out on password change", () => {
  it("reset-password signs out older access tokens and clears the refresh token", async () => {
    const crypto = require("crypto");
    const { user } = await createTestUser({ refreshToken: "old-rt" });
    const token = olderToken(user._id);

    const resetSession = "nonce";
    await Token.create({
      email: user.email,
      code: "used",
      verified: true,
      sessionHash: crypto.createHash("sha256").update(resetSession).digest("hex"),
    });

    const res = await request(app)
      .put("/api/user/reset-password")
      .send({ email: user.email, password: "BrandNew123!", resetSession });
    expect(res.status).toBe(200);

    expect((await getMe(token)).status).toBe(401);
    const fresh = await User.findById(user._id).lean();
    expect(fresh.refreshToken).toBeUndefined();
    expect(fresh.passwordChangedAt).toBeTruthy();
  });

  it("leaves no same-second window: a token from the second of the change is retired", async () => {
    const { user, rawPassword } = await createTestUser();
    const sameSecond = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });

    const res = await request(app)
      .put("/api/user/update-password")
      .set("Authorization", `Bearer ${sameSecond}`)
      .send({ currentPassword: rawPassword, newPassword: "BrandNew123!" });
    expect(res.status).toBe(200);

    expect((await getMe(sameSecond)).status).toBe(401);
    expect((await getMe(res.body.token)).status).toBe(200);
  });

  it("unrelated saves do not sign anyone out", async () => {
    const { user } = await createTestUser();
    const token = olderToken(user._id);
    const doc = await User.findById(user._id);
    doc.nickname = "changed";
    await doc.save();

    expect(doc.passwordChangedAt).toBeUndefined();
    expect((await getMe(token)).status).toBe(200);
  });

  it("a rider changing their password gets a new token pair", async () => {
    const { user, rawPassword } = await createTestUser({ role: ["dispatch"], activeRole: "dispatch" });
    const token = olderToken(user._id);

    const res = await request(app)
      .put("/api/delivery-agent/account")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: rawPassword, password: "BrandNew123!" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();

    expect((await getMe(token)).status).toBe(401);
    expect((await getMe(res.body.token)).status).toBe(200);
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
