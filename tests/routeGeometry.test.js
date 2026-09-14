const {
  decodePolyline,
  haversineMeters,
  minDistToPolyline,
} = require("../utils/routeGeometry");

// A straight ~2 km east-west road at Lagos latitude.
const WEST = [6.5, 3.35];
const EAST = [6.5, 3.368];
const MID_LNG = 3.359;

describe("decodePolyline", () => {
  it("decodes the reference polyline5 vector", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });
});

describe("haversineMeters", () => {
  it("measures Ikeja → Lagos Island at roughly 9 km", () => {
    const d = haversineMeters(6.6018, 3.3515, 6.5244, 3.3792);
    expect(d).toBeGreaterThan(8800);
    expect(d).toBeLessThan(9500);
  });
});

describe("minDistToPolyline", () => {
  it("treats a rider mid-way along a straight segment as on route", () => {
    const d = minDistToPolyline(6.5, MID_LNG, [WEST, EAST]);
    expect(d).toBeLessThan(1);

    // Regression: the old vertex-only check saw this rider ~1 km off route
    // and fired a Directions call on every ping.
    const nearestVertex = Math.min(
      haversineMeters(6.5, MID_LNG, ...WEST),
      haversineMeters(6.5, MID_LNG, ...EAST),
    );
    expect(nearestVertex).toBeGreaterThan(900);
  });

  it("measures perpendicular offset from the road", () => {
    // 0.0003° of latitude ≈ 33 m north of the road
    const d = minDistToPolyline(6.5003, MID_LNG, [WEST, EAST]);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(37);
  });

  it("clamps to the segment end rather than extending the line", () => {
    const beyond = [6.5, 3.37]; // past the east end
    const d = minDistToPolyline(...beyond, [WEST, EAST]);
    expect(Math.abs(d - haversineMeters(...beyond, ...EAST))).toBeLessThan(1);
  });

  it("uses the closest of several segments", () => {
    const north = [6.52, 3.368]; // road turns north at EAST
    const d = minDistToPolyline(6.51, 3.3681, [WEST, EAST, north]);
    expect(d).toBeLessThan(15);
  });

  it("handles degenerate polylines", () => {
    expect(minDistToPolyline(6.5, 3.35, [])).toBe(Infinity);
    expect(minDistToPolyline(6.5, 3.35, [WEST])).toBeLessThan(1);
  });
});
