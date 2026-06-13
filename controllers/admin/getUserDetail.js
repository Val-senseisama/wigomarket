const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");
const Wallet = require("../../models/walletModel");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function getUserDetail
 * @description Full user record plus linked store, dispatch profile and wallet.
 * @access Admin only
 */
const getUserDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const user = await User.findById(id)
    .select("-password -refreshToken")
    .populate("store")
    .populate("dispatchProfile")
    .lean();

  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const wallet = await Wallet.findOne({ user: id }).lean();

  res.json({ success: true, data: { user, wallet } });
});

module.exports = getUserDetail;
