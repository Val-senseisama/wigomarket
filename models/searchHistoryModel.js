const mongoose = require("mongoose");

const searchHistorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    query: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
  },
  { timestamps: true },
);

// One entry per (user, query). Upsert keeps the latest timestamp.
searchHistorySchema.index({ user: 1, query: 1 }, { unique: true });

// TTL — auto-delete entries older than 90 days
searchHistorySchema.index(
  { updatedAt: 1 },
  { expireAfterSeconds: 90 * 24 * 3600 },
);

module.exports = mongoose.model("SearchHistory", searchHistorySchema);
