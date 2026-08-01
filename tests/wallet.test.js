jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const { createTestUser } = require("./helpers");

// Wallet router is mounted at /api, its routes carry the /wallet prefix
// createWallet requires the first bank account in the body; it is set as default.
const bankAccount = {
  accountName: "Test User",
  accountNumber: "0123456789",
  bankName: "Test Bank",
  phoneNumber: "08012345678",
};

describe("Wallet - POST /api/wallet/create", () => {
  it("creates a wallet for authenticated user", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/wallet/create")
      .set("Authorization", `Bearer ${token}`)
      .send(bankAccount);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it("rejects wallet creation without bank account details", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/wallet/create")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects duplicate wallet creation", async () => {
    const { token } = await createTestUser();

    await request(app)
      .post("/api/wallet/create")
      .set("Authorization", `Bearer ${token}`)
      .send(bankAccount);

    const res = await request(app)
      .post("/api/wallet/create")
      .set("Authorization", `Bearer ${token}`)
      .send(bankAccount);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).post("/api/wallet/create");
    expect(res.status).toBe(401);
  });
});

describe("Wallet - GET /api/wallet", () => {
  it("returns 404 when user has no wallet", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns wallet after creation", async () => {
    const { token } = await createTestUser();

    await request(app)
      .post("/api/wallet/create")
      .set("Authorization", `Bearer ${token}`)
      .send(bankAccount);

    const res = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/wallet");
    expect(res.status).toBe(401);
  });

  it("reports hasWithdrawalPin false before a PIN is set, true after", async () => {
    const { token } = await createTestUser();
    const auth = { Authorization: `Bearer ${token}` };

    await request(app).post("/api/wallet/create").set(auth).send(bankAccount);

    const before = await request(app).get("/api/wallet").set(auth);
    expect(before.status).toBe(200);
    expect(before.body.data.hasWithdrawalPin).toBe(false);

    const created = await request(app)
      .post("/api/wallet/pin")
      .set(auth)
      .send({ pin: "1234" });
    expect(created.status).toBe(201);

    const after = await request(app).get("/api/wallet").set(auth);
    expect(after.body.data.hasWithdrawalPin).toBe(true);

    // The hash must never leave the server
    expect(JSON.stringify(after.body)).not.toMatch(/\$2[aby]\$/);
    expect(after.body.data.withdrawalPin?.hash).toBeUndefined();
  });
});

describe("Wallet - deductFunds (model)", () => {
  const Wallet = require("../models/walletModel");
  const money = require("../utils/money");

  /**
   * Regression: `today` and `currentMonth` were declared inside the
   * `transactionType === "withdrawal"` branch, but the withdrawalFilter built
   * below references them unconditionally. Every non-withdrawal deduction
   * therefore threw "ReferenceError: today is not defined" before reaching the
   * database — silently breaking refunds and ledger reversals.
   */
  it("deducts for non-withdrawal types without throwing", async () => {
    const { user } = await createTestUser();
    const wallet = await Wallet.createWallet(user._id, 1000);

    await expect(wallet.deductFunds(250, "refund")).resolves.toBeTruthy();

    const fresh = await Wallet.findById(wallet._id);
    expect(fresh.balance).toBe(750);
  });

  it("handles reversal deductions too", async () => {
    const { user } = await createTestUser();
    const wallet = await Wallet.createWallet(user._id, 500);

    await expect(wallet.deductFunds(100, "reversal")).resolves.toBeTruthy();
    const fresh = await Wallet.findById(wallet._id);
    expect(fresh.balance).toBe(400);
  });

  it("still refuses to overdraw", async () => {
    const { user } = await createTestUser();
    const wallet = await Wallet.createWallet(user._id, 50);

    await expect(wallet.deductFunds(100, "refund")).rejects.toThrow(
      /Insufficient balance/,
    );
    const fresh = await Wallet.findById(wallet._id);
    expect(fresh.balance).toBe(50);
  });

  it("keeps the balance exact across fractional deductions", async () => {
    const { user } = await createTestUser();
    const wallet = await Wallet.createWallet(user._id, 100);

    await wallet.deductFunds(0.1, "refund");
    const w2 = await Wallet.findById(wallet._id);
    await w2.deductFunds(0.2, "refund");

    const fresh = await Wallet.findById(wallet._id);
    expect(money.toKobo(fresh.balance)).toBe(money.toKobo(99.7));
  });
});
