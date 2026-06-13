const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");

/**
 * @function listWallets
 * @description Paginated, status-filterable list of wallets.
 * @access Admin only
 *
 * Query params (all optional):
 *   status — active | suspended | frozen | closed
 *   page   — default 1
 *   limit  — default 20, max 100
 */
const listWallets = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  if (status) filter.status = status;

  const [wallets, total] = await Promise.all([
    Wallet.find(filter)
      .populate("user", "fullName email role")
      .sort({ balance: -1 })
      .skip(skip)
      .limit(limit),
    Wallet.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      wallets,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasMore: skip + wallets.length < total,
      },
    },
  });
});

module.exports = listWallets;
