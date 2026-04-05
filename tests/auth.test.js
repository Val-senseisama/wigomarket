jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const { createTestUser } = require("./helpers");

describe("Auth - Register (POST /api/user/register)", () => {
  it("creates a new buyer account", async () => {
    const res = await request(app).post("/api/user/register").send({
      email: "newbuyer@test.com",
      mobile: "08012345678",
      password: "SecurePass123!",
      fullName: "John Doe",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/verification/i);
  });

  it("rejects duplicate email", async () => {
    await request(app).post("/api/user/register").send({
      email: "duplicate@test.com",
      mobile: "08011111111",
      password: "SecurePass123!",
    });

    const res = await request(app).post("/api/user/register").send({
      email: "duplicate@test.com",
      mobile: "08022222222",
      password: "SecurePass123!",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects missing email", async () => {
    const res = await request(app).post("/api/user/register").send({
      mobile: "08033333333",
      password: "SecurePass123!",
    });

    expect(res.status).toBe(500);
  });

  it("rejects invalid email format", async () => {
    const res = await request(app).post("/api/user/register").send({
      email: "not-an-email",
      mobile: "08044444444",
      password: "SecurePass123!",
    });

    expect(res.status).toBe(500);
  });
});

describe("Auth - Login (POST /api/user/login)", () => {
  it("logs in with correct credentials", async () => {
    const { user, rawPassword } = await createTestUser({
      email: "logintest@test.com",
    });

    const res = await request(app).post("/api/user/login").send({
      email: "logintest@test.com",
      password: rawPassword,
    });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body._id).toBeDefined();
    expect(res.body.role).toContain("buyer");
  });

  it("rejects wrong password", async () => {
    await createTestUser({ email: "wrongpass@test.com" });

    const res = await request(app).post("/api/user/login").send({
      email: "wrongpass@test.com",
      password: "WrongPassword!",
    });

    expect(res.status).toBe(500);
  });

  it("rejects non-existent user", async () => {
    const res = await request(app).post("/api/user/login").send({
      email: "nobody@test.com",
      password: "AnyPassword123!",
    });

    expect(res.status).toBe(500);
  });

  it("rejects blocked user", async () => {
    const { rawPassword } = await createTestUser({
      email: "blocked@test.com",
      isBlocked: true,
    });

    const res = await request(app).post("/api/user/login").send({
      email: "blocked@test.com",
      password: rawPassword,
    });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });
});

describe("Auth - Get Current User (GET /api/user/me)", () => {
  it("returns user info with valid token", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .get("/api/user/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("rejects request without token", async () => {
    const res = await request(app).get("/api/user/me");
    expect(res.status).toBe(500);
  });
});
