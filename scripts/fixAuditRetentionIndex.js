#!/usr/bin/env node
/**
 * @file fixAuditRetentionIndex.js
 * @description Replace the old blanket 90-day TTL index on auditlogs.
 *
 * WHY THIS IS NEEDED
 * Mongoose creates indexes declared in a schema but never removes ones that
 * were dropped from it. The audit log used to carry:
 *
 *   { createdAt: 1 }, { expireAfterSeconds: 7776000 }   // 90 days
 *
 * which deleted EVERY entry — wallet debits, payouts, refunds included — three
 * months after it was written. The schema now uses a per-document `expiresAt`
 * so financial and security entries are kept indefinitely, but until the old
 * index is physically dropped from the database it keeps deleting them
 * regardless of what the schema says.
 *
 * Run this once per environment, as part of deploying the retention change.
 *
 * USAGE
 *   node scripts/fixAuditRetentionIndex.js           # report only
 *   node scripts/fixAuditRetentionIndex.js --apply   # drop + create
 */

require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");
const COLLECTION = "auditlogs";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Aborting.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: COLLECTION }).toArray();

  if (collections.length === 0) {
    console.log(`Collection "${COLLECTION}" does not exist yet — nothing to do.`);
    await mongoose.connection.close();
    return;
  }

  const coll = db.collection(COLLECTION);
  const indexes = await coll.indexes();

  console.log(`\nIndexes on ${COLLECTION}:`);
  indexes.forEach((i) =>
    console.log(
      `  ${i.name}  keys=${JSON.stringify(i.key)}` +
        (i.expireAfterSeconds !== undefined
          ? `  TTL=${i.expireAfterSeconds}s`
          : ""),
    ),
  );

  // The offender: a TTL index on createdAt (whatever it happens to be named).
  const stale = indexes.filter(
    (i) => i.expireAfterSeconds !== undefined && i.key && i.key.createdAt === 1,
  );

  const hasNew = indexes.some(
    (i) => i.expireAfterSeconds !== undefined && i.key && i.key.expiresAt === 1,
  );

  console.log("");
  if (stale.length === 0) {
    console.log("✓ No blanket createdAt TTL index present.");
  } else {
    for (const idx of stale) {
      console.log(
        `✗ Stale TTL index "${idx.name}" deletes ALL audit entries after ${idx.expireAfterSeconds}s`,
      );
      if (APPLY) {
        await coll.dropIndex(idx.name);
        console.log(`  dropped ${idx.name}`);
      }
    }
  }

  if (hasNew) {
    console.log("✓ Per-document expiresAt TTL index present.");
  } else {
    console.log("✗ Per-document expiresAt TTL index missing.");
    if (APPLY) {
      await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      console.log("  created { expiresAt: 1 } TTL index");
    }
  }

  // Existing rows predate `expiresAt`; without it they would never expire.
  // Backfill routine entries so retention still applies to them, and leave
  // financial/security entries permanent by setting null.
  if (APPLY) {
    const PERMANENT = /^(wallet|payment|transaction|withdrawal|finance|vat|refund|billpayment|auth|admin)\./;
    const missing = await coll.countDocuments({ expiresAt: { $exists: false } });

    if (missing > 0) {
      const cutoff = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
      const permanent = await coll.updateMany(
        { expiresAt: { $exists: false }, action: { $regex: PERMANENT } },
        { $set: { expiresAt: null } },
      );
      const routine = await coll.updateMany(
        { expiresAt: { $exists: false } },
        { $set: { expiresAt: cutoff } },
      );
      console.log(
        `\nBackfilled ${missing} pre-existing entries: ` +
          `${permanent.modifiedCount} permanent, ${routine.modifiedCount} routine.`,
      );
    }
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to make these changes.");
  }

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("Failed:", err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
