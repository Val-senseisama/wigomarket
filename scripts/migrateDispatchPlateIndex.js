/**
 * One-off migration: make the dispatch-profile plateNumber index sparse.
 *
 * Non-motorised agents (feet, bicycle) have no plate number, so the old
 * NON-sparse unique index on `vehicleInfo.plateNumber` would treat every
 * plate-less profile as having a `null` value — and reject the second one with
 * a duplicate-key error. This swaps it for a `{ unique: true, sparse: true }`
 * index, which only indexes documents that actually have a plate number.
 *
 * Safe to run repeatedly (idempotent): it inspects the current indexes and only
 * acts when something needs changing.
 *
 *   node scripts/migrateDispatchPlateIndex.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const FIELD = "vehicleInfo.plateNumber";
const DESIRED = { unique: true, sparse: true };

const run = async () => {
  const uri =
    process.env.MONGODB_URI ||
    process.env.MONGODB_URL ||
    process.env.MONGO_URL;
  if (!uri) {
    throw new Error(
      "Set MONGODB_URI (or MONGODB_URL / MONGO_URL) to run this migration",
    );
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  const collection = mongoose.connection.db.collection("dispatchprofiles");

  const indexes = await collection.indexes();
  const existing = indexes.find(
    (idx) => idx.key && Object.keys(idx.key).length === 1 && idx.key[FIELD] === 1,
  );

  if (!existing) {
    console.log(`No single-field index on "${FIELD}" found — creating sparse unique index.`);
    await collection.createIndex({ [FIELD]: 1 }, DESIRED);
    console.log("Created sparse unique index.");
  } else if (existing.unique && existing.sparse) {
    console.log(`Index "${existing.name}" is already unique + sparse. Nothing to do.`);
  } else {
    console.log(
      `Found index "${existing.name}" (unique=${!!existing.unique}, sparse=${!!existing.sparse}). Recreating as unique + sparse…`,
    );
    await collection.dropIndex(existing.name);
    console.log(`  Dropped "${existing.name}".`);
    await collection.createIndex({ [FIELD]: 1 }, DESIRED);
    console.log("  Created sparse unique index.");
  }

  console.log("Done.");
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
