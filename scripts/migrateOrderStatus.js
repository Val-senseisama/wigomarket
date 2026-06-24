/**
 * One-off migration: convert legacy orderStatus values to the canonical state
 * machine tokens (see utils/orderStatus.js).
 *
 *   "Not yet processed" → pending
 *   "Pending"           → pending
 *   "Processing"        → preparing
 *   "Dispatched"        → inTransit
 *   "Delivered"         → delivered
 *   "Cancelled"         → cancelled
 *
 * Run once after deploying the state-machine change:
 *   node scripts/migrateOrderStatus.js
 */
const mongoose = require("mongoose");
require("dotenv").config();
const Order = require("../models/orderModel");

const MAPPING = {
  "Not yet processed": "pending",
  Pending: "pending",
  Processing: "preparing",
  Dispatched: "inTransit",
  Delivered: "delivered",
  Cancelled: "cancelled",
};

const run = async () => {
  const uri = process.env.MONGODB_URL || process.env.MONGO_URL;
  if (!uri) throw new Error("Set MONGODB_URL (or MONGO_URL) to run this migration");

  await mongoose.connect(uri);
  console.log("Connected to MongoDB");

  let total = 0;
  for (const [legacy, canonical] of Object.entries(MAPPING)) {
    const res = await Order.updateMany(
      { orderStatus: legacy },
      { $set: { orderStatus: canonical } },
    );
    console.log(`  ${legacy.padEnd(20)} → ${canonical.padEnd(12)} : ${res.modifiedCount} order(s)`);
    total += res.modifiedCount;
  }

  console.log(`Done. Migrated ${total} order(s).`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
