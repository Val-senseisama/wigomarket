jest.mock("../controllers/emailController", () => jest.fn().mockResolvedValue({}));
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: {}, error: null }) },
  })),
}));

// The route layer is tested against a mocked provider so the suite stays
// offline and deterministic. Live provider behaviour is exercised separately.
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
const mongoose = require("mongoose");
const app = require("../app");
const Store = require("../models/storeModel");
const mapboxService = require("../services/mapboxService");
const { createTestUser } = require("./helpers");

// Lagos landmarks used across the geo tests
const IKEJA = { lng: 3.3515, lat: 6.6018 };
const LAGOS_ISLAND = { lng: 3.3792, lat: 6.5244 }; // ~9 km from Ikeja
const LEKKI = { lng: 3.4723, lat: 6.4478 }; // ~22 km from Ikeja

let storeSeq = 0;
const seedStore = (name, coords) => {
  const unique = `${Date.now()}${String(++storeSeq).padStart(4, "0")}`;
  return Store.create({
    name: `${name} ${unique}`,
    // `email` carries a unique index — two stores left null collide
    email: `store-${unique}@example.com`,
    mobile: `2349${unique.slice(-8)}`,
    businessType: "retail",
    city: "Lagos",
    state: "Lagos",
    ownerNIN: unique.slice(-11),
    address: `${name}, Lagos`,
    location: {
      type: "Point",
      coordinates: [coords.lng, coords.lat],
    },
  });
};

beforeAll(async () => {
  // $geoNear requires the 2dsphere index to actually exist
  await Store.createIndexes();
});

beforeEach(() => {
  jest.clearAllMocks();
  mapboxService.isConfigured.mockReturnValue(true);
});

describe("Maps routes - authentication", () => {
  it("rejects unauthenticated requests to /api/maps/geocode", async () => {
    const res = await request(app).get("/api/maps/geocode?address=Ikeja");
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated requests to /api/maps/distance", async () => {
    const res = await request(app).get(
      "/api/maps/distance?originLat=6.6&originLng=3.35&destLat=6.44&destLng=3.47",
    );
    expect(res.status).toBe(401);
  });
});

describe("Maps routes - validation", () => {
  it("returns 400 when address is missing", async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .get("/api/maps/geocode")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when distance coordinates are incomplete", async () => {
    const { token } = await createTestUser();
    const res = await request(app)
      .get("/api/maps/distance?originLat=6.6&originLng=3.35")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it("returns 503 when the provider is not configured", async () => {
    const { token } = await createTestUser();
    mapboxService.isConfigured.mockReturnValue(false);

    const res = await request(app)
      .get("/api/maps/geocode?address=Ikeja")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(503);
  });
});

describe("Maps routes - happy paths", () => {
  it("geocodes an address", async () => {
    const { token } = await createTestUser();
    mapboxService.geocodeAddress.mockResolvedValue({
      lat: 6.6018,
      lng: 3.3515,
      formattedAddress: "Ikeja, Lagos, Nigeria",
      placeId: "address.123",
    });

    const res = await request(app)
      .get("/api/maps/geocode?address=Ikeja City Mall")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.lat).toBe(6.6018);
    expect(res.body.data.formattedAddress).toBe("Ikeja, Lagos, Nigeria");
  });

  it("returns 404 when an address cannot be geocoded", async () => {
    const { token } = await createTestUser();
    mapboxService.geocodeAddress.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/maps/geocode?address=nowhere at all")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it("returns road distance and drive time", async () => {
    const { token } = await createTestUser();
    mapboxService.getDistanceMatrix.mockResolvedValue({
      distanceMeters: 31854.9,
      durationSeconds: 2968.6,
      distanceText: "31.9 km",
      durationText: "49 mins",
    });

    const res = await request(app)
      .get(
        "/api/maps/distance?originLat=6.6018&originLng=3.3515&destLat=6.4478&destLng=3.4723",
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.distanceText).toBe("31.9 km");
    expect(mapboxService.getDistanceMatrix).toHaveBeenCalledWith(
      { lat: 6.6018, lng: 3.3515 },
      { lat: 6.4478, lng: 3.4723 },
    );
  });

  it("forwards the session token from autocomplete through to place details", async () => {
    const { token } = await createTestUser();
    mapboxService.getPlaceDetails.mockResolvedValue({
      lat: 6.5426,
      lng: 3.3746,
      formattedAddress: "City Of Power Av, Lagos",
      placeId: "abc123",
    });

    const res = await request(app)
      .get("/api/maps/places/details?placeId=abc123&sessiontoken=session-uuid-1")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    // Mapbox scopes placeId to the session that produced it — if the token is
    // dropped here the lookup 404s in production.
    expect(mapboxService.getPlaceDetails).toHaveBeenCalledWith(
      "abc123",
      "session-uuid-1",
    );
  });
});

describe("Maps routes - rate limiting", () => {
  it("returns 429 once a user exceeds the per-minute lookup budget", async () => {
    const { token } = await createTestUser();
    mapboxService.geocodeAddress.mockResolvedValue({
      lat: 6.6,
      lng: 3.35,
      formattedAddress: "Ikeja",
      placeId: "p1",
    });

    let limited = null;
    // Limit is 60/min; the 61st request from this user should be rejected.
    for (let i = 0; i < 61; i++) {
      const res = await request(app)
        .get("/api/maps/geocode?address=Ikeja")
        .set("Authorization", `Bearer ${token}`);
      if (res.status === 429) {
        limited = res;
        break;
      }
    }

    expect(limited).not.toBeNull();
    expect(limited.body.success).toBe(false);
    expect(limited.body.message).toMatch(/too many map lookups/i);
  });
});

describe("GET /api/sellers/nearby - $geoNear", () => {
  it("returns only stores inside the radius, nearest first, in km", async () => {
    await seedStore("Ikeja Store", IKEJA);
    await seedStore("Island Store", LAGOS_ISLAND);
    await seedStore("Lekki Store", LEKKI);

    const res = await request(app).get(
      `/api/sellers/nearby?lat=${IKEJA.lat}&lng=${IKEJA.lng}&radius=15`,
    );

    expect(res.status).toBe(200);
    const sellers = res.body.data.sellers;

    // Lekki (~22 km) is outside the 15 km radius
    expect(sellers).toHaveLength(2);
    expect(sellers[0].name).toMatch(/Ikeja Store/);
    expect(sellers[1].name).toMatch(/Island Store/);

    // Distances are kilometres, not metres, and sorted ascending
    expect(sellers[0].distance).toBeCloseTo(0, 1);
    expect(sellers[1].distance).toBeGreaterThan(8);
    expect(sellers[1].distance).toBeLessThan(11);
    expect(sellers[0].distance).toBeLessThan(sellers[1].distance);
  });

  it("widens results as the radius grows", async () => {
    await seedStore("Ikeja Store", IKEJA);
    await seedStore("Island Store", LAGOS_ISLAND);
    await seedStore("Lekki Store", LEKKI);

    const tight = await request(app).get(
      `/api/sellers/nearby?lat=${IKEJA.lat}&lng=${IKEJA.lng}&radius=5`,
    );
    const wide = await request(app).get(
      `/api/sellers/nearby?lat=${IKEJA.lat}&lng=${IKEJA.lng}&radius=30`,
    );

    expect(tight.body.data.sellers).toHaveLength(1);
    expect(wide.body.data.sellers).toHaveLength(3);
  });

  it("honours the limit parameter", async () => {
    await seedStore("Ikeja Store", IKEJA);
    await seedStore("Island Store", LAGOS_ISLAND);
    await seedStore("Lekki Store", LEKKI);

    const res = await request(app).get(
      `/api/sellers/nearby?lat=${IKEJA.lat}&lng=${IKEJA.lng}&radius=30&limit=2`,
    );

    expect(res.body.data.sellers).toHaveLength(2);
  });

  it("excludes stores that have no coordinates", async () => {
    await seedStore("Ikeja Store", IKEJA);
    // A store created without a geocoded address omits `location` entirely
    const unique = `${Date.now()}9999`;
    await Store.create({
      name: `No Location Store ${unique}`,
      email: `noloc-${unique}@example.com`,
      mobile: `2346${unique.slice(-8)}`,
      businessType: "retail",
      city: "Lagos",
      state: "Lagos",
      ownerNIN: unique.slice(-11),
      address: "Somewhere, Lagos",
    });

    const res = await request(app).get(
      `/api/sellers/nearby?lat=${IKEJA.lat}&lng=${IKEJA.lng}&radius=30`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.sellers).toHaveLength(1);
    expect(res.body.data.sellers[0].name).toMatch(/Ikeja Store/);
  });

  it("requires lat and lng", async () => {
    const res = await request(app).get("/api/sellers/nearby");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
