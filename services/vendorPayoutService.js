/**
 * @file vendorPayoutService.js
 * @description Who gets paid the vendor share of an order. Shared by every
 *              path that settles an order payment (webhook, /payment/verify,
 *              pending-payment cron) so they cannot drift apart. The ledger
 *              lines live in orderPaymentLedger.
 *
 * Order lines reference a *Store*; wallets belong to a *User*. Each store's
 * share is paid into its owner's wallet. Multi-store orders produce one payout
 * per store.
 *
 * Everything here runs inside the caller's session and does no external I/O.
 */

const Store = require("../models/storeModel");
const User = require("../models/userModel");
const Wallet = require("../models/walletModel");
const money = require("../utils/money");
const { vendorShares } = require("./commissionService");

/**
 * Resolve each store's share of the order to the user who owns that store.
 *
 * Throws if a store no longer exists or has no owner: crediting nobody would
 * either lose the seller's money or unbalance the ledger, so the payment is
 * left for retry (and surfaced by the caller's failure audit) instead.
 *
 * @returns {Promise<{ storeId, userId, amount: number }[]>} Zero shares omitted.
 */
async function resolveVendorPayouts(order, session) {
  const shares = vendorShares(order).filter((s) => s.amount > 0);
  if (!shares.length) return [];

  const stores = await Store.find({ _id: { $in: shares.map((s) => s.storeId) } })
    .select("owner")
    .session(session)
    .lean();
  const ownerByStore = new Map(stores.map((s) => [String(s._id), s.owner]));

  return shares.map(({ storeId, amount }) => {
    const userId = ownerByStore.get(String(storeId));
    if (!userId) {
      throw new Error(
        `Cannot pay vendor share for order ${order._id}: store ${storeId} ${
          ownerByStore.has(String(storeId)) ? "has no owner" : "not found"
        }`,
      );
    }
    return { storeId, userId, amount };
  });
}

/** Credit each payout to its seller's wallet, creating the wallet if needed. */
async function creditVendorWallets(payouts, session) {
  for (const { userId, amount } of payouts) {
    let wallet = await Wallet.findOne({ user: userId }).session(session);
    if (!wallet) {
      [wallet] = await Wallet.create([{ user: userId, balance: 0 }], { session });
    }
    await wallet.creditEarning(amount, session);
  }
}

/**
 * The seller whose profile decides VAT responsibility: the one with the
 * largest share (first store on a tie). Returns the User document, or null.
 */
async function primaryVendor(payouts, session) {
  if (!payouts.length) return null;
  const top = payouts.reduce((best, p) => (money.compare(p.amount, best.amount) > 0 ? p : best));
  return User.findById(top.userId).session(session);
}

module.exports = {
  resolveVendorPayouts,
  creditVendorWallets,
  primaryVendor,
};
