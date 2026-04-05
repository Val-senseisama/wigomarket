const { Client, Status } = require("@googlemaps/google-maps-services-js");
const appConfig = require("../config/appConfig");

/**
 * @class GoogleMapsService
 * @description Wrapper around Google Maps APIs for geocoding, reverse geocoding,
 * places autocomplete, distance matrix, and directions.
 * All location results are biased to Nigeria (NG).
 */
class GoogleMapsService {
  constructor() {
    this.client = new Client({});
    this.config = appConfig.maps.googleMaps;
  }

  get apiKey() {
    return this.config.apiKey;
  }

  /**
   * Check whether the API key is configured and valid.
   */
  isConfigured() {
    return this.config.validate();
  }

  // ─────────────────────────────────────────────────────────────
  //  GEOCODING  (address → coordinates)
  // ─────────────────────────────────────────────────────────────

  /**
   * Convert a human-readable address into coordinates.
   * @param {string} address
   * @returns {Promise<{lat: number, lng: number, formattedAddress: string} | null>}
   */
  async geocodeAddress(address) {
    if (!address || typeof address !== "string") return null;
    if (!this.isConfigured()) return null;

    try {
      const response = await this.client.geocode({
        params: {
          address: address.trim(),
          key: this.apiKey,
          region: this.config.region,
          language: this.config.language,
          components: `country:${this.config.countryRestriction}`,
        },
        timeout: 7000,
      });

      if (
        response.data.status === Status.OK &&
        response.data.results.length > 0
      ) {
        const result = response.data.results[0];
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          formattedAddress: result.formatted_address,
          placeId: result.place_id,
        };
      }

      console.warn(
        `[GoogleMaps] geocodeAddress – status: ${response.data.status} for "${address}"`,
      );
      return null;
    } catch (error) {
      console.error("[GoogleMaps] geocodeAddress error:", error.message);
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
      const response = await this.client.reverseGeocode({
        params: {
          latlng: { lat: parseFloat(lat), lng: parseFloat(lng) },
          key: this.apiKey,
          language: this.config.language,
          result_type: ["street_address", "route", "locality"],
        },
        timeout: 7000,
      });

      if (
        response.data.status === Status.OK &&
        response.data.results.length > 0
      ) {
        const result = response.data.results[0];
        // Build a structured components map
        const components = {};
        for (const comp of result.address_components) {
          for (const type of comp.types) {
            components[type] = comp.long_name;
          }
        }
        return {
          formattedAddress: result.formatted_address,
          components,
          placeId: result.place_id,
        };
      }

      return null;
    } catch (error) {
      console.error("[GoogleMaps] reverseGeocode error:", error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  PLACES AUTOCOMPLETE
  // ─────────────────────────────────────────────────────────────

  /**
   * Return place suggestions for a partial text input.
   * @param {string} input      - Partial address text
   * @param {string} [sessiontoken] - UUID session token (recommended by Google)
   * @returns {Promise<Array<{description: string, placeId: string}>>}
   */
  async getPlaceAutocomplete(input, sessiontoken) {
    if (!input || !this.isConfigured()) return [];

    try {
      const params = {
        input: input.trim(),
        key: this.apiKey,
        language: this.config.language,
        components: `country:${this.config.countryRestriction}`,
        types: "geocode",
      };

      if (sessiontoken) params.sessiontoken = sessiontoken;

      const response = await this.client.placeAutocomplete({
        params,
        timeout: 7000,
      });

      if (response.data.status === Status.OK) {
        return response.data.predictions.map((p) => ({
          description: p.description,
          placeId: p.place_id,
          mainText: p.structured_formatting?.main_text || "",
          secondaryText: p.structured_formatting?.secondary_text || "",
        }));
      }

      return [];
    } catch (error) {
      console.error("[GoogleMaps] placeAutocomplete error:", error.message);
      return [];
    }
  }

  /**
   * Resolve a placeId (from autocomplete) into full coordinates + address.
   * @param {string} placeId
   * @returns {Promise<{lat: number, lng: number, formattedAddress: string} | null>}
   */
  async getPlaceDetails(placeId) {
    if (!placeId || !this.isConfigured()) return null;

    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          key: this.apiKey,
          language: this.config.language,
          fields: ["geometry", "formatted_address", "place_id"],
        },
        timeout: 7000,
      });

      if (response.data.status === Status.OK && response.data.result) {
        const r = response.data.result;
        return {
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          formattedAddress: r.formatted_address,
          placeId: r.place_id,
        };
      }

      return null;
    } catch (error) {
      console.error("[GoogleMaps] placeDetails error:", error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  DISTANCE MATRIX
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
      const response = await this.client.distancematrix({
        params: {
          origins: [`${origin.lat},${origin.lng}`],
          destinations: [`${destination.lat},${destination.lng}`],
          key: this.apiKey,
          mode: "driving",
          language: this.config.language,
          region: this.config.region,
          units: "metric",
        },
        timeout: 7000,
      });

      if (response.data.status === Status.OK) {
        const row = response.data.rows[0];
        const element = row?.elements[0];

        if (element && element.status === "OK") {
          return {
            distanceMeters: element.distance.value,
            durationSeconds: element.duration.value,
            distanceText: element.distance.text,
            durationText: element.duration.text,
          };
        }
      }

      return null;
    } catch (error) {
      console.error("[GoogleMaps] distanceMatrix error:", error.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  DIRECTIONS  (for dispatch agent routing)
  // ─────────────────────────────────────────────────────────────

  /**
   * Get turn-by-turn directions with optional waypoints.
   * @param {{ lat: number, lng: number }} origin
   * @param {{ lat: number, lng: number }} destination
   * @param {Array<{ lat: number, lng: number }>} [waypoints]
   * @returns {Promise<{distance: number, duration: number, polyline: string, steps: Array} | null>}
   */
  async getDirections(origin, destination, waypoints = []) {
    if (!this.isConfigured()) return null;

    try {
      const params = {
        origin: `${origin.lat},${origin.lng}`,
        destination: `${destination.lat},${destination.lng}`,
        key: this.apiKey,
        mode: "driving",
        language: this.config.language,
        region: this.config.region,
        optimize: true,
      };

      if (waypoints.length > 0) {
        params.waypoints = waypoints.map((wp) => `${wp.lat},${wp.lng}`);
      }

      const response = await this.client.directions({
        params,
        timeout: 10000,
      });

      if (
        response.data.status === Status.OK &&
        response.data.routes.length > 0
      ) {
        const route = response.data.routes[0];
        const leg = route.legs[0]; // first leg (more legs if waypoints)

        // Aggregate totals across all legs
        let totalDistance = 0;
        let totalDuration = 0;
        const steps = [];

        for (const routeLeg of route.legs) {
          totalDistance += routeLeg.distance.value;
          totalDuration += routeLeg.duration.value;
          for (const step of routeLeg.steps) {
            steps.push({
              instruction: step.html_instructions.replace(/<[^>]*>/g, ""), // strip HTML tags
              distance: step.distance.value,
              duration: step.duration.value,
              startLocation: step.start_location,
              endLocation: step.end_location,
            });
          }
        }

        return {
          distance: totalDistance, // meters
          duration: totalDuration, // seconds
          polyline: route.overview_polyline.points, // encoded polyline
          steps,
          waypointOrder: route.waypoint_order || [],
          bounds: route.bounds,
        };
      }

      return null;
    } catch (error) {
      console.error("[GoogleMaps] directions error:", error.message);
      return null;
    }
  }
}

// Export singleton
module.exports = new GoogleMapsService();
