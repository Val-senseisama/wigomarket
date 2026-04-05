const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function updateDispatchProfile
 * @description Update dispatch profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Updated profile data
 * @returns {Object} - Updated dispatch profile
 */
const updateDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const updateData = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update dispatch profiles."
    });
  }

  try {
    const dispatchProfile = await DispatchProfile.findOneAndUpdate(
      { user: _id },
      updateData,
      { new: true, runValidators: true }
    );

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Dispatch profile not found"
      });
    }

    res.json({
      success: true,
      message: "Dispatch profile updated successfully",
      data: dispatchProfile
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to update dispatch profile");
  }

});

module.exports = updateDispatchProfile;
