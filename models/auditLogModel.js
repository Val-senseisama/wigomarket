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
// TTL — auto-delete logs older than 90 days
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
