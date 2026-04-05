jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));
jest.mock("../services/auditService", () => ({
  log: jest.fn().mockResolvedValue({}),
}));

const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");
const { createTestUser } = require("./helpers");

describe("Ratings - POST /api/rating", () => {
  it("rejects unauthenticated request", async () => {
    const res = await request(app).post("/api/rating").send({
      orderId: new mongoose.Types.ObjectId().toString(),
      rating: 4,
      breakdown: { punctuality: 4, professionalism: 4 },
    });

    expect(res.status).toBe(500);
  });

  it("rejects rating with missing fields", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/rating")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId: new mongoose.Types.ObjectId().toString() }); // missing rating and breakdown

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects rating out of range (>5)", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/rating")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderId: new mongoose.Types.ObjectId().toString(),
        rating: 6,
        breakdown: { punctuality: 5, professionalism: 5 },
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/1 and 5/i);
  });

  it("returns 404 for non-existent order", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/rating")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderId: new mongoose.Types.ObjectId().toString(),
        rating: 4,
        breakdown: { punctuality: 4, professionalism: 4 },
      });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("Ratings - GET /api/rating/my-ratings", () => {
  it("returns 200 with empty ratings for new user", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .get("/api/rating/my-ratings")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/rating/my-ratings");
    expect(res.status).toBe(500);
  });
});
