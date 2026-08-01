#!/usr/bin/env node
/**
 * @file normalizeMoneyPrecision.js
 * @description Find — and optionally repair — stored money values that are not
 * exact whole-kobo amounts.
 *
 * Money is stored as a Number of naira. Before utils/money existed, arithmetic
 * was done directly on those Numbers, so balances could pick up sub-kobo
 * residue (e.g. 4999.999999999999 instead of 5000). That residue is invisible
 * in most UIs, survives forever once written, and makes ledger reconciliation
 * ambiguous.
 *
 * All new arithmetic goes through utils/money, so no *new* residue is created.
 * This script cleans up what earlier code already wrote.
 *
 * USAGE
 *   node scripts/normalizeMoneyPrecision.js            # dry run — reports only
 *   node scripts/normalizeMoneyPrecision.js --apply    # write the corrections
 *
 * Always run the dry run first and read the report. Take a database backup
 * before --apply.
 *
 * ── On migrating to integer minor units ──────────────────────────────────────
 * Storing kobo as integers is stronger than storing naira as a Double, because
 * it makes the invalid states unrepresentable rather than merely unreachable.
 * That is a staged change, not a one-shot script, and it is deliberately NOT
 * done here:
 *
 *   1. Add parallel `*Kobo` integer fields to the money schemas.
 *   2. Dual-write both fields; keep reads on the naira field.
 *   3. Backfill `*Kobo` from the (now clean) naira values.
 *   4. Verify the two agree across the whole dataset for a full billing cycle.
 *   5. Flip reads to `*Kobo`, converting at the API boundary so clients see
 *      naira and the public contract does not change.
 *   6. Drop the naira fields.
 *
 * Steps 2-6 each need their own deploy and a rollback plan; running them
 * together against live balances is how money gets lost.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const money = require("../utils/money");

const APPLY = process.argv.includes("--apply");

/**
 * Money-bearing paths per collection. Dot notation is resolved manually so the
 * script does not depend on the Mongoose schema shape staying still.
 */
const TARGETS = [
  {
    model: "Wallet",
    file: "../models/walletModel",
    paths: [
      "balance",
      "limits.dailyWithdrawal",
      "limits.monthlyWithdrawal",
      "limits.minimumBalance",
      "withdrawalStats.dailyWithdrawn.amount",
      "withdrawalStats.monthlyWithdrawn.amount",
      "metadata.totalEarnings",
      "metadata.totalWithdrawals",
    ],
  },
  {
    model: "Transaction",
    file: "../models/transactionModel",
    paths: [
      "totalAmount",
      "vat.amount",
      "commission.platformAmount",
      "commission.vendorAmount",
      "commission.dispatchAmount",
    ],
    arrayPaths: [{ array: "entries", fields: ["debit", "credit"] }],
  },
  {
    model: "Order",
    file: "../models/orderModel",
    paths: ["deliveryFee", "paymentIntent.amount", "dispatchCommission"],
  },
  {
    model: "BillPayment",
    file: "../models/billPaymentModel",
    paths: ["amount"],
  },
];

const getPath = (doc, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), doc);

/** True when the value carries sub-kobo residue. */
function isDirty(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  // A clean value is exactly equal to its own kobo round-trip.
  return money.fromKobo(money.toKobo(value)) !== value;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Aborting.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(
    `\nConnected. Mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (read only)"}\n`,
  );

  let totalDirty = 0;
  let totalDocs = 0;

  for (const target of TARGETS) {
    let Model;
    try {
      Model = require(target.file);
    } catch {
      console.log(`- ${target.model}: model not found, skipping`);
      continue;
    }

    const cursor = Model.find({}).cursor();
    let dirtyDocs = 0;
    let dirtyFields = 0;

    for await (const doc of cursor) {
      const updates = {};

      for (const path of target.paths) {
        const value = getPath(doc, path);
        if (isDirty(value)) {
          updates[path] = money.round(value);
          dirtyFields++;
        }
      }

      for (const { array, fields } of target.arrayPaths || []) {
        const items = getPath(doc, array) || [];
        items.forEach((item, i) => {
          for (const field of fields) {
            const value = item?.[field];
            if (isDirty(value)) {
              updates[`${array}.${i}.${field}`] = money.round(value);
              dirtyFields++;
            }
          }
        });
      }

      if (Object.keys(updates).length > 0) {
        dirtyDocs++;
        console.log(`  ${target.model} ${doc._id}`);
        for (const [path, corrected] of Object.entries(updates)) {
          const before =
            path.includes(".") && /\.\d+\./.test(path)
              ? "(array entry)"
              : getPath(doc, path);
          console.log(`    ${path}: ${before} → ${corrected}`);
        }

        if (APPLY) {
          await Model.updateOne({ _id: doc._id }, { $set: updates });
        }
      }
      totalDocs++;
    }

    console.log(
      `- ${target.model}: ${dirtyDocs} document(s), ${dirtyFields} field(s) with sub-kobo residue`,
    );
    totalDirty += dirtyFields;
  }

  console.log(`\nScanned ${totalDocs} document(s).`);
  if (totalDirty === 0) {
    console.log("No sub-kobo residue found — stored money is clean.\n");
  } else if (APPLY) {
    console.log(`Corrected ${totalDirty} field(s).\n`);
  } else {
    console.log(
      `${totalDirty} field(s) would be corrected. Re-run with --apply to write.\n`,
    );
  }

  await mongoose.connection.close();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
