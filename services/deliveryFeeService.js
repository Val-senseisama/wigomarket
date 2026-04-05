const googleMapsService = require("../services/googleMapsService");
const appConfig = require("../config/appConfig");

/**
 * @class DeliveryFeeService
 * @description Calculate delivery fees based on road distance using Google Maps Distance Matrix API
 */
class DeliveryFeeService {
  constructor() {
    this.deliveryConfig = appConfig.delivery;
  }

  /**
   * Calculate delivery fee based on store and user addresses / coordinates.
   *
   * @param {string|{lat:number,lng:number}} storeLocation  - Store address string OR coords object
   * @param {string|{lat:number,lng:number}} userLocation   - User address string  OR coords object
   * @returns {Promise<{fee:number, distance:number, estimatedTime:number, route:object}>}
   */
  async calculateDeliveryFee(storeLocation, userLocation) {
    try {
      // Validate Google Maps is configured
      if (!googleMapsService.isConfigured()) {
        console.warn(
          "[DeliveryFee] Google Maps not configured, using fallback base fee",
        );
        return this.getFallbackFee();
      }

      // Resolve to coordinate objects
      const storeCoords = await this._resolveCoords(storeLocation);
      const userCoords = await this._resolveCoords(userLocation);

      if (!storeCoords || !userCoords) {
        console.warn(
          "[DeliveryFee] Coordinate resolution failed, using fallback base fee",
        );
        return this.getFallbackFee();
      }

      // Get road distance via Distance Matrix
      const matrix = await googleMapsService.getDistanceMatrix(
        storeCoords,
        userCoords,
      );

      if (!matrix) {
        console.warn(
          "[DeliveryFee] Distance Matrix failed, using fallback base fee",
        );
        return this.getFallbackFee();
      }

      const distanceKm = matrix.distanceMeters / 1000;

      // Check maximum delivery range
      if (distanceKm > this.deliveryConfig.distanceRates.maxDistance) {
        throw new Error(
          `Delivery distance (${distanceKm.toFixed(2)}km) exceeds maximum allowed ` +
            `(${this.deliveryConfig.distanceRates.maxDistance}km)`,
        );
      }

      const fee = this.calculateFeeFromDistance(distanceKm);
      const estimatedTime = Math.ceil(matrix.durationSeconds / 60); // minutes

      return {
        fee: Math.round(fee),
        distance: Math.round(distanceKm * 100) / 100,
        estimatedTime,
        distanceText: matrix.distanceText,
        durationText: matrix.durationText,
      };
    } catch (error) {
      if (error.message.includes("exceeds maximum")) {
        throw error; // Re-throw distance limit errors
      }

      console.error("[DeliveryFee] Calculation error:", error.message);

      if (this.deliveryConfig.fallbackToBaseFee) {
        console.warn("[DeliveryFee] Using fallback base fee due to error");
        return this.getFallbackFee();
      }

      throw error;
    }
  }

  /**
   * Resolve a location value (string address OR {lat,lng} object) to a coords object.
   * @private
   * @param {string|{lat:number,lng:number}} location
   * @returns {Promise<{lat:number,lng:number}|null>}
   */
  async _resolveCoords(location) {
    if (!location) return null;

    // Already coordinates
    if (typeof location === "object" && location.lat !== undefined) {
      return { lat: parseFloat(location.lat), lng: parseFloat(location.lng) };
    }

    // String address → geocode
    const addressStr =
      typeof location === "object"
        ? `${location.street || ""}, ${location.city || ""}, ${location.state || ""}, ${location.country || ""}`.trim()
        : String(location);

    const geocoded = await googleMapsService.geocodeAddress(addressStr);
    if (!geocoded) return null;
    return { lat: geocoded.lat, lng: geocoded.lng };
  }

  /**
   * Calculate fee from distance using configured pricing tiers.
   * @param {number} distanceKm
   * @returns {number} Fee in NGN
   */
  calculateFeeFromDistance(distanceKm) {
    const { baseFee, distanceRates } = this.deliveryConfig;

    if (distanceKm <= distanceRates.baseDistance) {
      return baseFee;
    }

    const extraDistance = distanceKm - distanceRates.baseDistance;
    return baseFee + extraDistance * distanceRates.perKm;
  }

  /**
   * Fallback fee when maps API is unavailable.
   */
  getFallbackFee() {
    return {
      fee: this.deliveryConfig.baseFee,
      distance: 0,
      estimatedTime: 0,
      fallback: true,
    };
  }
}

module.exports = new DeliveryFeeService();
