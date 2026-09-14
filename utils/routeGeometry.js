/**
 * Route geometry helpers for live tracking: decoding Mapbox polylines and
 * measuring how far a rider is from their route.
 *
 * Kept free of I/O so the deviation maths can be unit-tested directly.
 */

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;

/**
 * Decode a precision-5 encoded polyline string into [[lat, lng], ...] pairs.
 * Mapbox uses the same format as Google (standard polyline encoding at 1e-5).
 */
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0; result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Haversine distance between two lat/lng points, in metres.
 */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Distance (metres) from a point to the segment a→b.
 *
 * Projects onto a flat plane centred on the point. Route segments are at most
 * a few kilometres long, where the error of that approximation is negligible
 * next to GPS noise — and it avoids spherical cross-track maths.
 */
function distToSegmentMeters(lat, lng, [aLat, aLng], [bLat, bLng]) {
  const cosLat = Math.cos(toRad(lat));
  const ax = toRad(aLng - lng) * cosLat * EARTH_RADIUS_M;
  const ay = toRad(aLat - lat) * EARTH_RADIUS_M;
  const bx = toRad(bLng - lng) * cosLat * EARTH_RADIUS_M;
  const by = toRad(bLat - lat) * EARTH_RADIUS_M;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  // Parameter of the closest point along a→b, clamped to the segment itself.
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));

  return Math.hypot(ax + t * dx, ay + t * dy);
}

/**
 * Minimum distance (metres) from (lat, lng) to a decoded polyline.
 *
 * Measures against every segment, not just the vertices. Mapbox emits few
 * vertices along straight roads, so a vertex-only check reports a rider
 * driving dead-centre on the route as hundreds of metres "off route".
 */
function minDistToPolyline(lat, lng, points) {
  if (!points.length) return Infinity;
  if (points.length === 1) {
    return haversineMeters(lat, lng, points[0][0], points[0][1]);
  }
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = distToSegmentMeters(lat, lng, points[i - 1], points[i]);
    if (d < min) min = d;
  }
  return min;
}

module.exports = {
  decodePolyline,
  haversineMeters,
  distToSegmentMeters,
  minDistToPolyline,
};
