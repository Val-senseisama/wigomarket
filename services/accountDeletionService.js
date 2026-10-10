/**
 * Self-service account deletion (DELETE /api/user/me).
 *
 * The user row is anonymised, not removed: orders, refunds and ledger entries
 * reference it and must keep resolving for buyers, sellers and finance. What
 * goes is everything that identifies or reaches the person — name, contact
 * details, addresses, device tokens, credentials — and the email/mobile are
 * released so they can sign up again.
 *
 * Deletion is refused while the account still has something in flight that
 * someone else depends on (an open order, an open refund) or money the
 * platform owes it (wallet balance, a pending withdrawal). Those have to be
 * finished or withdrawn first; nothing here moves money.
 */
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const User = require("../models/userModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Order = require("../models/orderModel");
const Refund = require("../models/refundModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const Token = require("../models/tokensModel");
const DispatchProfile = require("../models/dispatchProfileModel");
const money = require("../utils/money");
const { STATUS, statusMatchValues } = require("../utils/orderStatus");
const { invalidateDispatchProfile } = require("../utils/dispatchProfileCache");

// Every stored value (canonical + legacy spellings) that means the order is finished.
const FINISHED_ORDER_VALUES = [
  ...statusMatchValues(STATUS.DELIVERED),
  ...statusMatchValues(STATUS.CANCELLED),
];

const BLOCKER_MESSAGES = {
  open_orders_as_buyer: "You have orders that are not yet delivered or cancelled.",
  open_orders_as_seller: "Your store has orders that are not yet delivered or cancelled.",
  open_deliveries: "You have deliveries assigned to you that are not finished.",
  open_refunds: "You have refund requests that are still open.",
  wallet_balance: "Your wallet still has a balance. Withdraw it first.",
  pending_withdrawal: "You have a withdrawal that has not completed yet.",
};

/**
 * Everything that stops this user deleting their account right now.
 * @returns {Promise<Array<{code: string, message: string}>>} empty when clear
 */
const findBlockers = async (userId) => {
  const store = await Store.findOne({ owner: userId }, "_id").lean();
  const open = { orderStatus: { $nin: FINISHED_ORDER_VALUES } };

  const [buyerOrder, sellerOrder, delivery, refund, wallet, withdrawal] =
    await Promise.all([
      Order.exists({ ...open, orderedBy: userId }),
      store ? Order.exists({ ...open, "products.store": store._id }) : null,
      Order.exists({ ...open, $or: [{ deliveryAgent: userId }, { dispatch: userId }] }),
      Refund.exists({
        open: true,
        $or: [{ buyer: userId }, ...(store ? [{ store: store._id }] : [])],
      }),
      Wallet.findOne({ user: userId }, "balance").lean(),
      Transaction.exists({
        type: "wallet_withdrawal",
        status: "pending",
        "entries.userId": userId,
      }),
    ]);

  const codes = [];
  if (buyerOrder) codes.push("open_orders_as_buyer");
  if (sellerOrder) codes.push("open_orders_as_seller");
  if (delivery) codes.push("open_deliveries");
  if (refund) codes.push("open_refunds");
  if (wallet && money.gt(wallet.balance || 0, 0)) codes.push("wallet_balance");
  if (withdrawal) codes.push("pending_withdrawal");

  return codes.map((code) => ({ code, message: BLOCKER_MESSAGES[code] }));
};

/**
 * Anonymise the user and switch off everything they own. Callers must check
 * findBlockers() first.
 */
const anonymiseAccount = async (user) => {
  const userId = user._id;
  const originalEmail = user.email;

  // A bcrypt hash of random bytes: well-formed, so isPasswordMatched() simply
  // returns false, but no one knows a password that matches it.
  const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

  // findByIdAndUpdate, not save(): the pre-save hook would hash the hash again.
  await User.findByIdAndUpdate(userId, {
    $set: {
      status: "deleted",
      deletedAt: new Date(),
      email: `deleted-${userId}@deleted.wigomarket.invalid`,
      fullName: "Deleted user",
      firstname: "Deleted",
      lastname: "User",
      password: unusablePassword,
      cart: [],
      savedAddresses: [],
      fcmTokens: [],
    },
    $unset: {
      mobile: 1,
      firebaseUid: 1,
      refreshToken: 1,
      pendingEmail: 1,
      address: 1,
      residentialAddress: 1,
      city: 1,
      state: 1,
      image: 1,
      nickname: 1,
      gender: 1,
      nextOfKin: 1,
      passwordRefreshToken: 1,
      passwordResetExpiresAt: 1,
    },
  });

  const store = await Store.findOne({ owner: userId }, "_id").lean();
  const profile = await DispatchProfile.findOne({ user: userId }, "_id").lean();

  await Promise.all([
    Token.deleteMany({ email: { $in: [originalEmail, user.pendingEmail].filter(Boolean) } }),
    // Balance is zero (findBlockers), so closing it strands nothing.
    Wallet.updateOne({ user: userId }, { $set: { status: "closed" } }),
    store && Store.updateOne({ _id: store._id }, { $set: { status: "suspended" } }),
    store && Product.updateMany({ store: store._id }, { $set: { status: "hidden" } }),
    profile &&
      DispatchProfile.updateOne(
        { _id: profile._id },
        { $set: { status: "suspended", isActive: false } },
      ),
  ]);

  if (profile) await invalidateDispatchProfile(userId);

  return { storeId: store?._id || null, dispatchProfileId: profile?._id || null };
};

module.exports = { findBlockers, anonymiseAccount, BLOCKER_MESSAGES };
