const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");
const validateMongodbId = require("../../utils/validateMongodbId");

const VALID_STATUSES = ["active", "suspended", "frozen", "closed"];

/**
 * @function setWalletStatus
 * @description Set a wallet's status. Note: the wallet model blocks balance
 *   mutations on non-active wallets, so suspending/freezing effectively halts
 *   payouts and earnings for that user.
 * @access Admin only
 *
 * Body: { status: "frozen", reason?: "..." }
 */
const setWalletStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reason } = req.body;
  validateMongodbId(id);

  if (!VALID_STATUSES.includes(status)) {
    res.status(400);
    throw new Error(`status must be one of: ${VALID_STATUSES.join(", ")}`);
  }

  const wallet = await Wallet.findById(id);
  if (!wallet) {
    res.status(404);
    throw new Error("Wallet not found");
  }

  const before = { status: wallet.status };
  wallet.status = status;
  await wallet.save();

  audit.log({
    action: "admin.wallet.status_changed",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
    changes: { before, after: { status: wallet.status } },
    metadata: { reason, user: wallet.user },
  });

  res.json({
    success: true,
    message: `Wallet status set to ${status}`,
    data: { _id: wallet._id, status: wallet.status },
  });
});

module.exports = setWalletStatus;
