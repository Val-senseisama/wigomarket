/**
 * Application Configuration
 * Centralized configuration for business logic constants
 */

const appConfig = {
  // Delivery Configuration
  delivery: {
    // Base delivery fee in NGN (0-5km)
    baseFee: 1200,

    // Distance-based pricing
    distanceRates: {
      perKm: 100, // NGN per kilometer beyond base distance
      baseDistance: 5, // Free base distance (km)
      maxDistance: 100, // Maximum delivery distance (km)
    },

    // Fallback behavior
    fallbackToBaseFee: true, // Use baseFee if calculation fails

    // Future: Add zone-based pricing
    zones: {
      local: 1200,
      interstate: 2000,
      international: 5000,
    },
  },

  // Payment Configuration
  payment: {
    // Flutterwave settings
    flutterwave: {
      publicKey: process.env.FLW_PUBLIC_KEY,
      secretKey: process.env.FLW_SECRET_KEY,
      encryptionKey: process.env.FLW_ENCRYPTION_KEY,
      webhookSecretHash: process.env.FLW_WEBHOOK_SECRET_HASH,

      // Validate configuration on load
      validate() {
        const missing = [];
        if (!this.publicKey) missing.push("FLW_PUBLIC_KEY");
        if (!this.secretKey) missing.push("FLW_SECRET_KEY");
        if (!this.webhookSecretHash) missing.push("FLW_WEBHOOK_SECRET_HASH");

        if (missing.length > 0) {
          console.warn(
            `⚠️  Missing Flutterwave configuration: ${missing.join(", ")}`,
          );
          return false;
        }
        return true;
      },
    },

    // Payment limits
    limits: {
      minimumAmount: 100, // Minimum payment amount in NGN
      maximumAmount: 10000000, // Maximum single transaction (10M NGN)
    },
  },

  // Commission Configuration
  commission: {
    platformRate: 0.05, // 5% platform commission
    dispatchRate: 1.0, // 100% of delivery fee goes to dispatch
  },

  // Wallet Configuration
  wallet: {
    minimumBalance: 0,
    maximumBalance: 50000000, // 50M NGN
    withdrawalLimits: {
      daily: 1000000, // 1M NGN
      monthly: 10000000, // 10M NGN
    },
  },

  // Maps Configuration (Google Maps)
  maps: {
    googleMaps: {
      apiKey: process.env.GOOGLE_MAPS_API_KEY,

      // Default region bias for Lagos / Nigeria
      region: "NG",
      language: "en",
      countryRestriction: "ng", // ISO 3166-1 alpha-2

      validate() {
        if (!this.apiKey || this.apiKey === "YOUR_GOOGLE_MAPS_API_KEY_HERE") {
          console.warn(
            "⚠️  GOOGLE_MAPS_API_KEY not configured. Distance-based delivery fees will use fallback.",
          );
          return false;
        }
        return true;
      },
    },
  },
};

// Validate Flutterwave config on module load
if (appConfig.payment.flutterwave.publicKey) {
  appConfig.payment.flutterwave.validate();
}

module.exports = appConfig;
