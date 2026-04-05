jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const { createTestUser } = require("./helpers");

// Wallet router is mounted at /api (no /wallet prefix)
describe("Wallet - POST /api/create", () => {
  it("creates a wallet for authenticated user", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it("rejects duplicate wallet creation", async () => {
    const { token } = await createTestUser();

    await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).post("/api/create");
    expect(res.status).toBe(500);
  });
});

describe("Wallet - GET /api/ (get wallet)", () => {
  it("returns 404 when user has no wallet", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .get("/api/")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns wallet after creation", async () => {
    const { token } = await createTestUser();

    await request(app)
      .post("/api/create")
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .get("/api/")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/");
    expect(res.status).toBe(500);
  });
});
