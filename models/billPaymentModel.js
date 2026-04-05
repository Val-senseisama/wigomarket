const mongoose = require("mongoose");

const billPaymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // The requestId sent to VTpass — UNIQUE. Guards against calling VTpass twice
    // for the same logical purchase even if the client retries.
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Internal transaction reference (links to the Transaction ledger)
    transactionRef: {
      type: String,
      required: true,
      index: true,
    },

    serviceType: {
      type: String,
      required: true,
      enum: ["airtime", "data", "electricity", "cable_tv", "jamb", "waec"],
      index: true,
    },

    serviceProvider: {
      type: String,
      required: true, // e.g. "mtn", "ikeja-electric", "dstv"
    },

    // Amount charged to the wallet
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Status mirrors VTpass delivery state
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    // Recipient info (phone for airtime/data, meter/smartcard for utility)
    recipient: {
      type: String,
      required: true,
    },

    // Extra service-specific data (variation_code, meter_type, etc.)
    serviceMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Full VTpass response (stored for debugging and requery)
    vtpassResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Extracted delivery artefacts (electricity token, cable pin, etc.)
    deliveryToken: String, // electricity token
    units: String, // electricity units
    pin: String, // JAMB/WAEC pin

    // Timestamps for lifecycle tracking
    completedAt: Date,
    failedAt: Date,
    refundedAt: Date,

    // Link to the refund Transaction ledger entry (if any)
    refundTransactionRef: String,
  },
  {
    timestamps: true,
  },
);

// ── Indexes ──────────────────────────────────────────────────────────────────
billPaymentSchema.index({ user: 1, serviceType: 1, createdAt: -1 });
billPaymentSchema.index({ status: 1, createdAt: 1 }); // for cron requery

// ── Schema-level validation ──────────────────────────────────────────────────

// Prevent amount <= 0 at DB level
billPaymentSchema.path("amount").validate(function (v) {
  return v > 0;
}, "Payment amount must be greater than zero");

// ── Static helpers ───────────────────────────────────────────────────────────

/**
 * Find all pending bill payments older than `minutesOld` minutes.
 * Used by the cron to requery VTpass.
 */
billPaymentSchema.statics.findPendingForRequery = function (minutesOld = 5) {
  const cutoff = new Date(Date.now() - minutesOld * 60 * 1000);
  return this.find({
    status: "pending",
    createdAt: { $lte: cutoff },
  }).limit(100);
};

module.exports = mongoose.model("BillPayment", billPaymentSchema);
