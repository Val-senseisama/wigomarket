/**
 * Live ETA + rerouting on POST /api/location/update.
 *
 * The pickup stop must follow the ORDER's deliveryStatus. It used to follow
 * LocationTracking.status, which only changes if the client calls
 * PUT /api/location/status — so riders who never did were routed back
 * through the store for the whole delivery.
 */
jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));
jest.mock("../services/mapboxService", () => ({
  isConfigured: jest.fn().mockReturnValue(true),
  geocodeAddress: jest.fn(),
  reverseGeocode: jest.fn(),
  getPlaceAutocomplete: jest.fn(),
  getPlaceDetails: jest.fn(),
  getDistanceMatrix: jest.fn(),
  getDirections: jest.fn(),
}));

const request = require("supertest");
const app = require("../app");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const mapboxService = require("../services/mapboxService");
const { createTestUser } = require("./helpers");

const RIDER = { lat: 6.6, lng: 3.35 };
const STORE = { lat: 6.58, lng: 3.36 };
const DROPOFF = { lat: 6.52, lng: 3.38 };

// Matrix durations, in seconds, per leg.
const RIDER_TO_STORE = 300;
const STORE_TO_DROPOFF = 600;
const RIDER_TO_DROPOFF = 700;

const same = (a, b) =>
  Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;

// Minimal polyline5 encoder so the mocked Directions call returns a real,
// decodable route through exactly the points it was asked for.
const encodePolyline = (points) => {
  let out = "", prevLat = 0, prevLng = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let str = "";
    while (n >= 0x20) {
      str += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return str + String.fromCharCode(n + 63);
  };
  for (const { lat, lng } of points) {
    const la = Math.round(lat * 1e5), ln = Math.round(lng * 1e5);
    out += enc(la - prevLat) + enc(ln - prevLng);
    prevLat = la; prevLng = ln;
  }
  return out;
};

let seq = 0;
const seedOrder = async (agentId, deliveryStatus) => {
  const unique = `${Date.now()}${String(++seq).padStart(4, "0")}`;
  const store = await Store.create({
    name: `Routing Store ${unique}`,
    email: `route-${unique}@example.com`,
    mobile: `2349${unique.slice(-8)}`,
    businessType: "retail",
    city: "Lagos",
    state: "Lagos",
    ownerNIN: unique.slice(-11),
    address: "Store, Lagos",
    location: { type: "Point", coordinates: [STORE.lng, STORE.lat] },
  });
  const { user: buyer } = await createTestUser();
  return Order.create({
    products: [{ product: store._id, count: 1, store: store._id }],
    orderedBy: buyer._id,
    deliveryAgent: agentId,
    deliveryMethod: "delivery_agent",
    deliveryAddress: "Dropoff, Lagos",
    deliveryLocation: { type: "Point", coordinates: [DROPOFF.lng, DROPOFF.lat] },
    deliveryStatus,
    orderStatus: "inTransit",
    paymentStatus: "Paid",
    deliveryFee: 1200,
    paymentIntent: { amount: 6200, currency: "NGN" },
  });
};

const ping = (token, orderId, extra = {}) =>
  request(app)
    .post("/api/location/update")
    .set("Authorization", `Bearer ${token}`)
    .send({ latitude: RIDER.lat, longitude: RIDER.lng, orderId, ...extra });

let agent, token;

beforeEach(async () => {
  jest.clearAllMocks();
  mapboxService.isConfigured.mockReturnValue(true);
  mapboxService.reverseGeocode.mockResolvedValue({ formattedAddress: "Lagos" });
  mapboxService.getDistanceMatrix.mockImplementation(async (from, to) => {
    let durationSeconds;
    if (same(from, STORE) && same(to, DROPOFF)) durationSeconds = STORE_TO_DROPOFF;
    else if (same(to, STORE)) durationSeconds = RIDER_TO_STORE;
    else if (same(to, DROPOFF)) durationSeconds = RIDER_TO_DROPOFF;
    else return null;
    return { distanceMeters: 1000, durationSeconds, distanceText: "1 km", durationText: "x" };
  });
  mapboxService.getDirections.mockImplementation(async (from, to, waypoints = []) => ({
    distance: 9000,
    duration: 1000,
    polyline: encodePolyline([from, ...waypoints, to]),
    steps: [],
  }));

  ({ user: agent, token } = await createTestUser({
    role: ["dispatch"],
    activeRole: "dispatch",
  }));
});

describe("POST /api/location/update — before pickup", () => {
  it("routes through the store and adds the store leg to the ETA", async () => {
    const order = await seedOrder(agent._id, "assigned");

    // First ping: no stored route yet → plan one, via the store.
    const first = await ping(token, order._id.toString());
    expect(first.status).toBe(200);
    expect(first.body.data.nextStop).toBe("pickup");
    expect(first.body.data.rerouted).toBe(true);
    const [, , waypoints] = mapboxService.getDirections.mock.calls[0];
    expect(waypoints).toHaveLength(1);
    expect(same(waypoints[0], STORE)).toBe(true);
    expect(first.body.data.eta.text).toBe("17 mins"); // 1000 s from Directions

    // Second ping on that route: no reroute, ETA = rider→store + store→dropoff.
    mapboxService.getDirections.mockClear();
    const second = await ping(token, order._id.toString());
    expect(second.body.data.rerouted).toBe(false);
    expect(mapboxService.getDirections).not.toHaveBeenCalled();
    expect(second.body.data.eta.seconds).toBe(RIDER_TO_STORE + STORE_TO_DROPOFF);
    expect(second.body.data.eta.text).toBe("15 mins");
  });
});

describe("POST /api/location/update — after pickup", () => {
  it("skips the store once the ORDER is picked up, even though tracking.status is still 'assigned'", async () => {
    const order = await seedOrder(agent._id, "picked_up");

    const first = await ping(token, order._id.toString());
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("assigned"); // tracking never advanced
    expect(first.body.data.nextStop).toBe("dropoff");
    const [, , waypoints] = mapboxService.getDirections.mock.calls[0];
    expect(waypoints).toEqual([]);

    const second = await ping(token, order._id.toString());
    expect(second.body.data.rerouted).toBe(false);
    expect(second.body.data.eta.seconds).toBe(RIDER_TO_DROPOFF);
  });

  it("reroutes when the rider leaves the route beyond threshold + GPS accuracy", async () => {
    const order = await seedOrder(agent._id, "picked_up");
    await ping(token, order._id.toString()); // establish the route
    mapboxService.getDirections.mockClear();

    // ~330 m west of the route start — off route even with a 50 m allowance.
    const res = await ping(token, order._id.toString(), {
      longitude: RIDER.lng - 0.003,
      accuracy: 200,
    });
    expect(res.body.data.rerouted).toBe(true);
    expect(mapboxService.getDirections).toHaveBeenCalledTimes(1);
  });

  it("does not reroute on GPS noise within the accuracy allowance", async () => {
    const order = await seedOrder(agent._id, "picked_up");
    await ping(token, order._id.toString());
    mapboxService.getDirections.mockClear();

    // ~66 m west: beyond the bare 50 m threshold, inside 50 m + 30 m accuracy.
    const res = await ping(token, order._id.toString(), {
      longitude: RIDER.lng - 0.0006,
      accuracy: 30,
    });
    expect(res.body.data.rerouted).toBe(false);
    expect(mapboxService.getDirections).not.toHaveBeenCalled();
  });
});
