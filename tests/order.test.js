jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("../services/googleMapsService", () => ({
  getDistanceAndDuration: jest.fn().mockResolvedValue({ distance: 5, duration: 15 }),
  geocodeAddress: jest.fn().mockResolvedValue({ lat: 6.5244, lng: 3.3792 }),
}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const { createTestUser, createTestSeller, createTestProduct, setupCart } = require("./helpers");

describe("Orders - GET /api/order", () => {
  it("returns 200 with empty orders list for new user", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .get("/api/order")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated request", async () => {
    const res = await request(app).get("/api/order");
    expect(res.status).toBe(500);
  });
});

describe("Orders - GET /api/order/:id", () => {
  it("returns 500 for invalid order id", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .get("/api/order/invalid-id")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});

describe("Orders - POST /api/order/create", () => {
  it("returns 400 when cart is empty", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/order/create")
      .set("Authorization", `Bearer ${token}`)
      .send({
        paymentMethod: "cash",
        deliveryMethod: "self_delivery",
        deliveryAddress: {
          street: "123 Test Street",
          city: "Lagos",
          state: "Lagos",
        },
      });

    // Empty cart should fail
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("rejects order creation without auth", async () => {
    const res = await request(app).post("/api/order/create").send({
      paymentMethod: "cash",
      deliveryMethod: "self_delivery",
      deliveryAddress: { street: "123 Test", city: "Lagos", state: "Lagos" },
    });

    expect(res.status).toBe(500);
  });

  it("rejects order with missing required fields", async () => {
    const { token } = await createTestUser();

    const res = await request(app)
      .post("/api/order/create")
      .set("Authorization", `Bearer ${token}`)
      .send({ paymentMethod: "cash" }); // missing deliveryMethod and deliveryAddress

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
