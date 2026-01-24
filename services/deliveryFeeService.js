const axios = require("axios");
const appConfig = require("../config/appConfig");

/**
 * @class DeliveryFeeService
 * @description Calculate delivery fees based on distance using HERE Maps API
 */
class DeliveryFeeService {
  constructor() {
    this.config = appConfig.maps.hereMaps;
    this.deliveryConfig = appConfig.delivery;
  }

  /**
   * Calculate delivery fee based on store and user addresses
   * @param {string} storeAddress - Store address
   * @param {Object|string} userAddress - User delivery address (object or string)
   * @returns {Promise<{fee: number, distance: number, estimatedTime: number, route: object}>}
   */
  async calculateDeliveryFee(storeAddress, userAddress) {
    try {
      // Validate HERE Maps configuration
      if (!this.config.validate()) {
        console.warn("HERE Maps not configured, using fallback base fee");
        return this.getFallbackFee();
      }

      // Parse user address if it's an object
      const userAddressString =
        typeof userAddress === "object"
          ? `${userAddress.street || ""}, ${userAddress.city || ""}, ${userAddress.state || ""}, ${userAddress.country || ""}`.trim()
          : userAddress;

      // Geocode both addresses
      const [storeCoords, userCoords] = await Promise.all([
        this.getCoordinatesFromAddress(storeAddress),
        this.getCoordinatesFromAddress(userAddressString),
      ]);

      if (!storeCoords || !userCoords) {
        console.warn("Geocoding failed, using fallback base fee");
        return this.getFallbackFee();
      }

      // Calculate route and distance
      const route = await this.getRoute(storeCoords, userCoords);

      if (!route) {
        console.warn("Route calculation failed, using fallback base fee");
        return this.getFallbackFee();
      }

      // Convert distance from meters to kilometers
      const distanceKm = route.distance / 1000;

      // Check if distance exceeds maximum
      if (distanceKm > this.deliveryConfig.distanceRates.maxDistance) {
        throw new Error(
          `Delivery distance (${distanceKm.toFixed(2)}km) exceeds maximum allowed distance (${this.deliveryConfig.distanceRates.maxDistance}km)`,
        );
      }

      // Calculate fee based on distance
      const fee = this.calculateFeeFromDistance(distanceKm);

      // Estimated time in minutes
      const estimatedTime = Math.ceil(route.duration / 60);

      return {
        fee: Math.round(fee),
        distance: Math.round(distanceKm * 100) / 100, // Round to 2 decimals
        estimatedTime,
        route: {
          duration: route.duration,
          polyline: route.polyline,
        },
      };
    } catch (error) {
      if (error.message.includes("exceeds maximum")) {
        throw error; // Re-throw distance errors
      }

      console.error("Delivery fee calculation error:", error.message);

      if (this.deliveryConfig.fallbackToBaseFee) {
        console.warn("Using fallback base fee due to error");
        return this.getFallbackFee();
      }

      throw error;
    }
  }

  /**
   * Calculate fee from distance using configured pricing
   * @param {number} distanceKm - Distance in kilometers
   * @returns {number} - Calculated fee in NGN
   */
  calculateFeeFromDistance(distanceKm) {
    const { baseFee, distanceRates } = this.deliveryConfig;

    if (distanceKm <= distanceRates.baseDistance) {
      return baseFee;
    }

    const extraDistance = distanceKm - distanceRates.baseDistance;
    const extraFee = extraDistance * distanceRates.perKm;

    return baseFee + extraFee;
  }

  /**
   * Get fallback fee (base fee with no distance calculation)
   * @returns {{fee: number, distance: number, estimatedTime: number}}
   */
  getFallbackFee() {
    return {
      fee: this.deliveryConfig.baseFee,
      distance: 0,
      estimatedTime: 0,
      fallback: true,
    };
  }

  /**
   * Get coordinates from address using HERE Maps Geocoding API
   * @param {string} address - Address to geocode
   * @returns {Promise<[number, number]|null>} - [longitude, latitude] or null
   */
  async getCoordinatesFromAddress(address) {
    if (!address || typeof address !== "string") {
      return null;
    }

    try {
      const response = await axios.get(`${this.config.baseUrl}/v1/geocode`, {
        params: {
          q: address.trim(),
          apikey: this.config.apiKey,
          limit: 1,
        },
        timeout: 5000,
      });

      if (
        response.data &&
        response.data.items &&
        response.data.items.length > 0
      ) {
        const item = response.data.items[0];
        return [item.position.lng, item.position.lat];
      }

      return null;
    } catch (error) {
      console.error("Geocoding error:", error.message);
      return null;
    }
  }

  /**
   * Get route information using HERE Maps Routing API
   * @param {[number, number]} start - Start coordinates [lng, lat]
   * @param {[number, number]} end - End coordinates [lng, lat]
   * @returns {Promise<{distance: number, duration: number, polyline: string}|null>}
   */
  async getRoute(start, end) {
    try {
      const response = await axios.get(`${this.config.baseUrl}/v8/routes`, {
        params: {
          origin: `${start[1]},${start[0]}`, // lat,lng format
          destination: `${end[1]},${end[0]}`,
          apikey: this.config.apiKey,
          transportMode: "car",
          return: "polyline,summary",
        },
        timeout: 5000,
      });

      if (
        response.data &&
        response.data.routes &&
        response.data.routes.length > 0
      ) {
        const route = response.data.routes[0];
        const section = route.sections[0];

        return {
          distance: section.summary.length, // in meters
          duration: section.summary.duration, // in seconds
          polyline: section.polyline,
        };
      }

      return null;
    } catch (error) {
      console.error("Routing error:", error.message);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new DeliveryFeeService();
