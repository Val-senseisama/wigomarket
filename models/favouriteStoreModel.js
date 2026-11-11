const mongoose = require("mongoose");

/**
 * A buyer's favourite (saved) shop — the heart on a vendor card.
 * One row per user × store, so saving is idempotent (unique index) and the
 * "Favourite vendors" screen pages straight off the index, newest first.
 */
const favouriteStoreSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true },
  },
  { timestamps: true },
);

favouriteStoreSchema.index({ user: 1, store: 1 }, { unique: true });
favouriteStoreSchema.index({ user: 1, createdAt: -1 });
// Cleanup when a store is deleted.
favouriteStoreSchema.index({ store: 1 });

module.exports = mongoose.model("FavouriteStore", favouriteStoreSchema);
