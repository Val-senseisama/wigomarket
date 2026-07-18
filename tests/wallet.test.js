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
    expect(res.status).toBe(500);
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
    expect(res.status).toBe(500);
  });
});
