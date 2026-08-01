const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    // What happened
    action: {
      type: String,
      required: true,
      index: true,
      // Format: resource.verb  e.g. order.created, product.deleted, user.blocked
    },

    // Who did it
    actor: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
      email: { type: String },       // denormalized — survives user deletion
      role: { type: String },        // active role at time of action
      ip: { type: String },
      userAgent: { type: String },
    },

    // What was affected
    resource: {
      type: {
        type: String,
        enum: [
          "order", "product", "category", "store",
          "user", "wallet", "payment", "transaction",
          "dispatch", "rating", "wishlist",
          "system",   // cron jobs, background tasks, infrastructure events
        ],
        index: true,
      },
      id: { type: mongoose.Schema.Types.ObjectId, index: true },
      displayName: { type: String }, // human-readable: order #ABC123, product "Red Shoes"
    },

    // Request ID from x-request-id header — correlates audit entries to app logs
    requestId: { type: String, index: true },

    // Before / after state (only relevant fields, not full documents)
    changes: {
      before: { type: mongoose.Schema.Types.Mixed },
      after:  { type: mongoose.Schema.Types.Mixed },
    },

    // Any extra context that doesn't fit above
    metadata: { type: mongoose.Schema.Types.Mixed },

    status: {
      type: String,
      enum: ["success", "failed"],
      default: "success",
    },

    // When this entry becomes eligible for automatic deletion.
    // `null` (or absent) means it is retained indefinitely — MongoDB's TTL
    // monitor ignores documents whose indexed field is not a Date. Financial
    // and security entries are written with null; see auditService.
    expiresAt: { type: Date, default: null },
  },
  {
    timestamps: true,          // createdAt is the authoritative timestamp
    versionKey: false,
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────
// "What did this user do?"
auditLogSchema.index({ "actor.userId": 1, createdAt: -1 });
// "What happened to this resource?"
auditLogSchema.index({ "resource.type": 1, "resource.id": 1, createdAt: -1 });
// "All events of this type?"
auditLogSchema.index({ action: 1, createdAt: -1 });

// Retention is per-document rather than a blanket age cut-off.
//
// The previous index expired EVERY entry 90 days after creation, including
// wallet debits, payouts and refunds — far short of the multi-year retention
// financial records require, and it deleted the evidence of any discrepancy
// that had not yet been investigated. Now each entry carries its own
// `expiresAt`; entries written with `expiresAt: null` are never collected.
auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
