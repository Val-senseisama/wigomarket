/**
 * Guards the boundary between the two status endpoints that look like
 * duplicates but are not:
 *
 *   PUT /api/location/status              → LocationTracking (map/journey state)
 *   PUT /api/delivery-agent/orders/status → Order (delivery lifecycle)
 *
 * The location endpoint used to accept "delivered" and write the order
 * directly, bypassing the dual-confirm flow. Because both confirm paths throw
 * once deliveryStatus is DELIVERED, that permanently stranded the rider's
 * earnings with no API route to recover them. These tests pin that door shut.
 */
jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

const request = require("supertest");
const app = require("../app");
const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const { createTestUser } = require("./helpers");

// These endpoints reject before any deep population, so bare refs are enough —
// avoids depending on the seller/store fixtures for a pure validation test.
const makeAssignedOrder = async (agentId, buyerId) =>
  Order.create({
    products: [
      {
        product: new mongoose.Types.ObjectId(),
        count: 1,
        store: new mongoose.Types.ObjectId(),
      },
    ],
    orderedBy: buyerId,
    deliveryAgent: agentId,
    deliveryMethod: "delivery_agent",
    deliveryAddress: "24 Olu Obasanjo Road, Port Harcourt",
    deliveryStatus: "in_transit",
    orderStatus: "inTransit",
    paymentStatus: "Paid",
    deliveryFee: 1200,
    paymentIntent: { amount: 6200, currency: "NGN" },
  });

describe("PUT /api/location/status — delivered is not accepted", () => {
  let agentToken, order;

  beforeEach(async () => {
    const { user: agent, token } = await createTestUser({
      role: ["dispatch"],
      activeRole: "dispatch",
    });
    agentToken = token;
    const { user: buyer } = await createTestUser();
    order = await makeAssignedOrder(agent._id, buyer._id);
  });

  it("rejects status 'delivered' with 400 and points at confirm-delivery", async () => {
    const res = await request(app)
      .put("/api/location/status")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ orderId: order._id.toString(), status: "delivered" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/confirm-delivery/);
  });

  it("does NOT mark the order delivered when 'delivered' is attempted", async () => {
    await request(app)
      .put("/api/location/status")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ orderId: order._id.toString(), status: "delivered" });

    const after = await Order.findById(order._id);
    // The whole point: the order must still be confirmable, so earnings
    // can still be credited through the dual-confirm flow.
    expect(after.deliveryStatus).toBe("in_transit");
    expect(after.actualDeliveryTime).toBeUndefined();
  });

  it("still rejects other invalid statuses with 400", async () => {
    const res = await request(app)
      .put("/api/location/status")
      .set("Authorization", `Bearer ${agentToken}`)
      .send({ orderId: order._id.toString(), status: "teleported" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid status/);
  });
});

describe("PUT /api/delivery-agent/orders/status — owns the order lifecycle", () => {
  it("rejects 'delivered' and directs to the confirm-delivery flow", async () => {
    const { user: agent, token } = await createTestUser({
      role: ["dispatch"],
      activeRole: "dispatch",
    });
    const { user: buyer } = await createTestUser();
    const order = await makeAssignedOrder(agent._id, buyer._id);

    const res = await request(app)
      .put("/api/delivery-agent/orders/status")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderId: order._id.toString(), status: "delivered" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/confirm-delivery/);
  });
});
