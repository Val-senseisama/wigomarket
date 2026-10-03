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
    // The provider new checkouts, payouts and bank lookups go to. Existing
    // charges are always verified and refunded through the provider that took
    // them (see services/payments).
    provider: (process.env.PAYMENT_PROVIDER || "monnify").toLowerCase(),

    // Monnify settings
    monnify: {
      apiKey: process.env.MONNIFY_API_KEY,
      secretKey: process.env.MONNIFY_SECRET_KEY,
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      // Disbursement wallet that withdrawals are paid from.
      walletAccountNumber: process.env.MONNIFY_WALLET_ACCOUNT_NUMBER,
      environment: (process.env.MONNIFY_ENV || "SANDBOX").toUpperCase(),
      get baseUrl() {
        return this.environment === "LIVE" ? "https://api.monnify.com" : "https://sandbox.monnify.com";
      },

      validate() {
        const missing = [];
        if (!this.apiKey) missing.push("MONNIFY_API_KEY");
        if (!this.secretKey) missing.push("MONNIFY_SECRET_KEY");
        if (!this.contractCode) missing.push("MONNIFY_CONTRACT_CODE");
        if (!this.walletAccountNumber) missing.push("MONNIFY_WALLET_ACCOUNT_NUMBER");
        if (missing.length > 0) {
          console.warn(`⚠️  Missing Monnify configuration: ${missing.join(", ")}`);
          return false;
        }
        return true;
      },
    },

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

  // Maps Configuration (Mapbox)
  maps: {
    mapbox: {
      accessToken: process.env.MAPBOX_ACCESS_TOKEN,

      // Default region bias for Lagos / Nigeria
      language: "en",
      countryRestriction: "ng", // ISO 3166-1 alpha-2
      profile: "driving", // routing profile for matrix + directions

      validate() {
        if (
          !this.accessToken ||
          this.accessToken === "YOUR_MAPBOX_ACCESS_TOKEN_HERE"
        ) {
          console.warn(
            "⚠️  MAPBOX_ACCESS_TOKEN not configured. Distance-based delivery fees will use fallback.",
          );
          return false;
        }
        return true;
      },
    },
  },
};

// Validate the active provider's config on module load
if (appConfig.payment.provider === "monnify" && appConfig.payment.monnify.apiKey) {
  appConfig.payment.monnify.validate();
}
if (appConfig.payment.provider === "flutterwave" && appConfig.payment.flutterwave.publicKey) {
  appConfig.payment.flutterwave.validate();
}

module.exports = appConfig;
