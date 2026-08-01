const axios = require("axios");
const appConfig = require("../config/appConfig");

const GEOCODE_BASE = "https://api.mapbox.com/search/geocode/v6";
const SEARCHBOX_BASE = "https://api.mapbox.com/search/searchbox/v1";
const MATRIX_BASE = "https://api.mapbox.com/directions-matrix/v1/mapbox";
const DIRECTIONS_BASE = "https://api.mapbox.com/directions/v5/mapbox";

/**
 * Format a distance in metres the way Google's Distance Matrix used to,
 * so downstream consumers rendering `distanceText` keep working unchanged.
 */
function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format a duration in seconds as "1 hour 5 mins" / "12 mins".
 */
function formatDuration(seconds) {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min${totalMinutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  if (minutes === 0) return hourPart;
  return `${hourPart} ${minutes} min${minutes === 1 ? "" : "s"}`;
}

/**
 * @class MapboxService
 * @description Wrapper around the Mapbox APIs for geocoding, reverse geocoding,
 * search/autocomplete, travel-time matrix, and directions.
 * All location results are biased to Nigeria (NG).
 *
 * Deliberately exposes the same method signatures and return shapes as the
 * Google Maps service it replaces, so callers need no changes. Every method
 * resolves to `null` (or `[]`) on failure rather than throwing — callers such
 * as deliveryFeeService rely on that to fall back cleanly.
 */
class MapboxService {
  constructor() {
    this.config = appConfig.maps.mapbox;
  }

  get accessToken() {
    return this.config.accessToken;
  }

  /**
   * Check whether the access token is configured.
   */
  isConfigured() {
    return this.config.validate();
  }

  /**
   * Shared GET helper. Returns response data, or null on any failure.
   * @private
   */
  async _get(url, params, timeout = 7000) {
    const response = await axios.get(url, {
      params: { ...params, access_token: this.accessToken },
      timeout,
    });
    return response.data;
  }

  // ─────────────────────────────────────────────────────────────
  //  GEOCODING  (address → coordinates)
  // ─────────────────────────────────────────────────────────────

  /**
   * Convert a human-readable address into coordinates.
   * @param {string} address
   * @returns {Promise<{lat: number, lng: number, formattedAddress: string, placeId: string} | null>}
   */
  async geocodeAddress(address) {
    if (!address || typeof address !== "string") return null;
    if (!this.isConfigured()) return null;

    try {
      const data = await this._get(`${GEOCODE_BASE}/forward`, {
        q: address.trim(),
        country: this.config.countryRestriction,
        language: this.config.language,
        limit: 1,
      });

      const feature = data?.features?.[0];
      if (!feature) {
        console.warn(`[Mapbox] geocodeAddress – no result for "${address}"`);
        return null;
      }

      // Mapbox GeoJSON coordinates are [longitude, latitude]
      const [lng, lat] = feature.geometry.coordinates;
      return {
        lat,
        lng,
        formattedAddress:
          feature.properties.full_address || feature.properties.name,
        placeId: feature.properties.mapbox_id,
      };
    } catch (error) {
      console.error("[Mapbox] geocodeAddress error:", error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  REVERSE GEOCODING  (coordinates → address)
  // ─────────────────────────────────────────────────────────────

  /**
   * Convert a lat/lng pair back into a human-readable address.
   * @param {number} lat
   * @param {number} lng
   * @returns {Promise<{formattedAddress: string, components: object, placeId: string} | null>}
   */
  async reverseGeocode(lat, lng) {
    if (!this.isConfigured()) return null;

    try {
      const data = await this._get(`${GEOCODE_BASE}/reverse`, {
        longitude: parseFloat(lng),
        latitude: parseFloat(lat),
        language: this.config.language,
        limit: 1,
      });

      const feature = data?.features?.[0];
      if (!feature) return null;

      // Flatten Mapbox's `context` into a Google-style components map so
      // existing consumers can keep reading familiar keys.
      const components = {};
      const context = feature.properties.context || {};
      for (const [key, value] of Object.entries(context)) {
        if (value?.name) components[key] = value.name;
      }
      // Google-compatible aliases for the keys consumers are likeliest to use
      if (context.place?.name) components.locality = context.place.name;
      if (context.region?.name)
        components.administrative_area_level_1 = context.region.name;
      if (context.country?.name) components.country = context.country.name;
      if (context.postcode?.name) components.postal_code = context.postcode.name;
      if (context.street?.name) components.route = context.street.name;

      return {
        formattedAddress:
          feature.properties.full_address || feature.properties.name,
        components,
        placeId: feature.properties.mapbox_id,
      };
    } catch (error) {
      console.error("[Mapbox] reverseGeocode error:", error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  SEARCH BOX AUTOCOMPLETE
  // ─────────────────────────────────────────────────────────────

  /**
   * Return place suggestions for a partial text input.
   *
   * NOTE: Mapbox ties a suggestion's `mapbox_id` to the `sessiontoken` used
   * here — the id can only be resolved by getPlaceDetails() within the same
   * session. Callers that persist an id for later resolution must persist the
   * session token alongside it, or store the resolved lat/lng instead.
   *
   * @param {string} input          - Partial address text
   * @param {string} [sessiontoken] - UUID session token (required by Mapbox for retrieve)
   * @returns {Promise<Array<{description: string, placeId: string, mainText: string, secondaryText: string}>>}
   */
  async getPlaceAutocomplete(input, sessiontoken) {
    if (!input || !this.isConfigured()) return [];

    try {
      const data = await this._get(`${SEARCHBOX_BASE}/suggest`, {
        q: input.trim(),
        country: this.config.countryRestriction,
        language: this.config.language,
        session_token: sessiontoken || "",
        types: "address,street,place,locality,neighborhood,poi",
      });

      return (data?.suggestions || []).map((s) => ({
        description: s.place_formatted
          ? `${s.name}, ${s.place_formatted}`
          : s.name,
        placeId: s.mapbox_id,
        mainText: s.name || "",
        secondaryText: s.place_formatted || "",
      }));
    } catch (error) {
      console.error("[Mapbox] suggest error:", error.message);
      return [];
    }
  }

  /**
   * Resolve a placeId (mapbox_id from autocomplete) into coordinates + address.
   * Must use the same session token that produced the suggestion.
   * @param {string} placeId
   * @param {string} [sessiontoken]
   * @returns {Promise<{lat: number, lng: number, formattedAddress: string, placeId: string} | null>}
   */
  async getPlaceDetails(placeId, sessiontoken) {
    if (!placeId || !this.isConfigured()) return null;

    try {
      const data = await this._get(
        `${SEARCHBOX_BASE}/retrieve/${encodeURIComponent(placeId)}`,
        { session_token: sessiontoken || "" },
      );

      const feature = data?.features?.[0];
      if (!feature) return null;

      const [lng, lat] = feature.geometry.coordinates;
      return {
        lat,
        lng,
        formattedAddress:
          feature.properties.full_address || feature.properties.name,
        placeId: feature.properties.mapbox_id || placeId,
      };
    } catch (error) {
      console.error("[Mapbox] retrieve error:", error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  MATRIX  (travel distance + duration)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get road distance and duration between two coordinate pairs.
   * @param {{ lat: number, lng: number }} origin
   * @param {{ lat: number, lng: number }} destination
   * @returns {Promise<{distanceMeters: number, durationSeconds: number, distanceText: string, durationText: string} | null>}
   */
  async getDistanceMatrix(origin, destination) {
    if (!this.isConfigured()) return null;

    try {
      // Mapbox encodes coordinates in the path as lng,lat pairs joined by ";"
      const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;

      // Mapbox rejects a 1x1 matrix ("minimum number of matrix elements is 2"),
      // so request the full 2x2 and read the origin → destination cell.
      const data = await this._get(
        `${MATRIX_BASE}/${this.config.profile}/${coords}`,
        { annotations: "distance,duration" },
      );

      if (data?.code !== "Ok") {
        console.warn(`[Mapbox] matrix – code: ${data?.code}`);
        return null;
      }

      const distanceMeters = data.distances?.[0]?.[1];
      const durationSeconds = data.durations?.[0]?.[1];

      // Mapbox returns null for an unroutable pair rather than an error code
      if (distanceMeters == null || durationSeconds == null) {
        console.warn("[Mapbox] matrix – no route between the given points");
        return null;
      }

      return {
        distanceMeters,
        durationSeconds,
        distanceText: formatDistance(distanceMeters),
        durationText: formatDuration(durationSeconds),
      };
    } catch (error) {
      console.error("[Mapbox] matrix error:", error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  DIRECTIONS  (for dispatch agent routing)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get turn-by-turn directions with optional waypoints.
   *
   * Waypoints are visited in the order given — Mapbox exposes reordering
   * through its separate Optimization API, not the Directions API, so
   * `waypointOrder` is always the identity order here.
   *
   * @param {{ lat: number, lng: number }} origin
   * @param {{ lat: number, lng: number }} destination
   * @param {Array<{ lat: number, lng: number }>} [waypoints]
   * @returns {Promise<{distance: number, duration: number, polyline: string, steps: Array, waypointOrder: Array, bounds: object|null} | null>}
   */
  async getDirections(origin, destination, waypoints = []) {
    if (!this.isConfigured()) return null;

    try {
      const points = [origin, ...waypoints, destination];
      const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");

      const data = await this._get(
        `${DIRECTIONS_BASE}/${this.config.profile}/${coords}`,
        {
          geometries: "polyline", // precision-5 encoded polyline, same as Google's
          overview: "full",
          steps: true,
          language: this.config.language,
        },
        10000,
      );

      if (data?.code !== "Ok" || !data.routes?.length) {
        console.warn(`[Mapbox] directions – code: ${data?.code}`);
        return null;
      }

      const route = data.routes[0];

      // Aggregate every leg into one flat step list, matching the old shape.
      // A Mapbox step carries only its start (the maneuver location), so each
      // step's end is taken from the next step's start.
      const steps = [];
      for (const leg of route.legs || []) {
        const legSteps = leg.steps || [];
        legSteps.forEach((step, i) => {
          const start = step.maneuver?.location || [];
          const end = legSteps[i + 1]?.maneuver?.location || start;
          steps.push({
            // Mapbox instructions are already plain text — no HTML to strip
            instruction: step.maneuver?.instruction || "",
            distance: step.distance,
            duration: step.duration,
            startLocation: { lat: start[1], lng: start[0] },
            endLocation: { lat: end[1], lng: end[0] },
          });
        });
      }

      return {
        distance: route.distance, // metres
        duration: route.duration, // seconds
        polyline: route.geometry, // encoded polyline
        steps,
        waypointOrder: waypoints.map((_, i) => i),
        bounds: null, // Mapbox Directions does not return a bounding box
      };
    } catch (error) {
      console.error("[Mapbox] directions error:", error.message);
      return null;
    }
  }
}

// Export singleton
module.exports = new MapboxService();
