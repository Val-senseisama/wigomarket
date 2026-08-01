const mongoose = require("mongoose");

/**
 * @file walletDriftModel.js
 * @description Durable record of a wallet whose stored balance disagrees with
 * the balance derived from its ledger entries.
 *
 * The daily reconciliation used to only emit an alert email and an audit-log
 * entry. Both are transient — the email can be missed and the audit log is on a
 * retention window — so a discrepancy had no state and nobody could answer
 * "is this still broken?". This collection gives drift a lifecycle:
 *
 *   OPEN → INVESTIGATING → RESOLVED
 *                        → ACCEPTED   (reviewed, deliberately written off)
 *
 * There is deliberately NO TTL here. Unresolved financial discrepancies must
 * outlive log retention.
 */
const walletDriftSchema = new mongoose.Schema(
  {
    wallet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Wallet",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // Snapshot of both sides at detection time, in naira for readability…
    walletBalance: { type: Number, required: true },
    ledgerBalance: { type: Number, required: true },

    // …and the authoritative difference in whole kobo (integer, exact).
    // Positive = wallet holds more than the ledger justifies.
    driftKobo: { type: Number, required: true },

    status: {
      type: String,
      enum: ["open", "investigating", "resolved", "accepted"],
      default: "open",
      index: true,
    },

    // How many consecutive reconciliation runs have seen this same drift.
    // A climbing count means an active leak rather than a one-off.
    occurrences: { type: Number, default: 1 },
    firstDetectedAt: { type: Date, default: Date.now },
    lastDetectedAt: { type: Date, default: Date.now },

    resolvedAt: { type: Date },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolutionNotes: { type: String },
  },
  { timestamps: true },
);

// One open record per wallet — repeat detections update it rather than piling up
walletDriftSchema.index(
  { wallet: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);

/**
 * Record a detected drift. Idempotent per wallet: if an open record already
 * exists it is updated in place and its occurrence count incremented, so a
 * recurring discrepancy reads as one ongoing issue.
 *
 * @param {Object} params
 * @param {mongoose.Types.ObjectId} params.wallet
 * @param {mongoose.Types.ObjectId} params.user
 * @param {number} params.walletBalance
 * @param {number} params.ledgerBalance
 * @param {number} params.driftKobo
 */
walletDriftSchema.statics.recordDrift = async function ({
  wallet,
  user,
  walletBalance,
  ledgerBalance,
  driftKobo,
}) {
  const now = new Date();
  return this.findOneAndUpdate(
    { wallet, status: "open" },
    {
      $set: {
        user,
        walletBalance,
        ledgerBalance,
        driftKobo,
        lastDetectedAt: now,
      },
      $setOnInsert: { firstDetectedAt: now, status: "open" },
      $inc: { occurrences: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

/**
 * Every wallet discrepancy still awaiting a human decision.
 */
walletDriftSchema.statics.openDrifts = function () {
  return this.find({ status: { $in: ["open", "investigating"] } })
    .sort({ lastDetectedAt: -1 })
    .populate("user", "fullName email");
};

module.exports = mongoose.model("WalletDrift", walletDriftSchema);
