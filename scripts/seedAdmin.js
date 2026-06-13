require("dotenv").config();
const { dbConnect, dbDisconnect } = require("../config/dbConnect");
const User = require("../models/userModel");

/**
 * Promote an existing user to admin by email.
 *
 * Adds "admin" to the user's role array (deduped). The user keeps their current
 * activeRole — admin endpoints require switching into admin mode explicitly via
 * PUT /api/user/change-role { "role": "admin" }.
 *
 * Usage:
 *   node scripts/seedAdmin.js admin@example.com
 *   ADMIN_EMAIL=admin@example.com node scripts/seedAdmin.js
 *   npm run seed:admin -- admin@example.com
 */
const seedAdmin = async () => {
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (!email) {
    console.error(
      "❌ No email provided. Usage: node scripts/seedAdmin.js <email> (or set ADMIN_EMAIL)",
    );
    process.exit(1);
  }

  await dbConnect();

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`❌ No user found with email "${email}". Create the account first.`);
    await dbDisconnect();
    process.exit(1);
  }

  if (user.role.includes("admin")) {
    console.log(`ℹ️  ${email} is already an admin. No changes made.`);
    await dbDisconnect();
    process.exit(0);
  }

  // findOneAndUpdate (not .save()) avoids the userModel pre-save hook, which
  // re-hashes the password on every save and would lock the user out.
  const updated = await User.findByIdAndUpdate(
    user._id,
    {
      role: [...new Set([...user.role, "admin"])],
      // Ensure the account is usable (authMiddleware blocks non-active accounts)
      status: "active",
    },
    { new: true },
  );

  console.log(`✅ ${email} promoted to admin. Roles: ${updated.role.join(", ")}`);
  console.log(
    'ℹ️  To use admin endpoints, log in then PUT /api/user/change-role { "role": "admin" }.',
  );

  await dbDisconnect();
  process.exit(0);
};

seedAdmin().catch(async (err) => {
  console.error("💥 seedAdmin failed:", err.message);
  await dbDisconnect().catch(() => {});
  process.exit(1);
});
