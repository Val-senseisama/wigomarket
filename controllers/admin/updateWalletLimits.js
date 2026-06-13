const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function updateWalletLimits
 * @description Update a wallet's withdrawal/balance limits. Any subset of the
 *   three limit fields may be supplied.
 * @access Admin only
 *
 * Body: { dailyWithdrawal?, monthlyWithdrawal?, minimumBalance? }
 */
const updateWalletLimits = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { dailyWithdrawal, monthlyWithdrawal, minimumBalance } = req.body;
  validateMongodbId(id);

  const updates = { dailyWithdrawal, monthlyWithdrawal, minimumBalance };
  const provided = Object.entries(updates).filter(([, v]) => v !== undefined);
  if (provided.length === 0) {
    res.status(400);
    throw new Error(
      "Provide at least one of: dailyWithdrawal, monthlyWithdrawal, minimumBalance",
    );
  }
  for (const [key, value] of provided) {
    if (typeof value !== "number" || value < 0) {
      res.status(400);
      throw new Error(`${key} must be a non-negative number`);
    }
  }

  const wallet = await Wallet.findById(id);
  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  const snapshot = (w) => ({
    dailyWithdrawal: w.limits.dailyWithdrawal,
    monthlyWithdrawal: w.limits.monthlyWithdrawal,
    minimumBalance: w.limits.minimumBalance,
  });

  const before = snapshot(wallet);
  for (const [key, value] of provided) {
    wallet.limits[key] = value;
  }
  await wallet.save();

  audit.log({
    action: "admin.wallet.limits_updated",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
    changes: { before, after: snapshot(wallet) },
    metadata: { user: wallet.user },
  });

  res.json({
    success: true,
    message: "Wallet limits updated",
    data: { _id: wallet._id, limits: wallet.limits },
  });
});

module.exports = updateWalletLimits;
