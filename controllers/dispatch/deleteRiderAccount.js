const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const Wallet = require("../../models/walletModel");
const Order = require("../../models/orderModel");
const audit = require("../../services/auditService");
const redisClient = require("../../config/redisClient");

/**
 * @function deleteRiderAccount
 * @description Lets a delivery agent delete their own account. Blocked while the
 *              agent still has active deliveries or an unwithdrawn wallet balance
 *              so money/parcels are never stranded. Removes the user record and
 *              their dispatch profile.
 *
 *   For audit and financial integrity the wallet record itself is closed rather
 *   than hard-deleted.
 *
 * @param {string} req.user._id - Authenticated agent's ID
 */
const deleteRiderAccount = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can delete a rider account here.",
    });
  }

  // ── Block deletion while deliveries are in flight ─────────────────────────
  const activeDeliveries = await Order.countDocuments({
    deliveryAgent: _id,
    deliveryStatus: { $in: ["assigned", "picked_up", "in_transit"] },
  });
  if (activeDeliveries > 0) {
    return res.status(400).json({
      success: false,
      message: `You have ${activeDeliveries} active deliver${
        activeDeliveries === 1 ? "y" : "ies"
      }. Complete them before deleting your account.`,
    });
  }

  // ── Block deletion while there is money left to withdraw ──────────────────
  const wallet = await Wallet.findOne({ user: _id });
  if (wallet && wallet.balance > 0) {
    return res.status(400).json({
      success: false,
      message: `Withdraw your remaining balance of ₦${wallet.balance} before deleting your account.`,
    });
  }

  // ── Tear down ─────────────────────────────────────────────────────────────
  await DispatchProfile.deleteOne({ user: _id });
  if (wallet) {
    wallet.status = "closed";
    await wallet.save();
  }
  const deletedUser = await User.findByIdAndDelete(_id);

  try {
    await redisClient.del(`dispatch:profile:${_id}`);
  } catch (_) {}

  audit.log({
    action: "user.deleted",
    actor: audit.actor(req),
    resource: { type: "user", id: _id, displayName: deletedUser?.email },
    changes: { before: { email: deletedUser?.email, role: deletedUser?.role } },
    metadata: { selfService: true },
  });

  res.json({
    success: true,
    message: "Your rider account has been deleted.",
  });
});

module.exports = deleteRiderAccount;
