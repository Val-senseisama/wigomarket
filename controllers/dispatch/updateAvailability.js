const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function updateAvailability
 * @description Update delivery agent availability status
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.status - New availability status
 * @returns {Object} - Updated availability status
 */
const updateAvailability = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { status } = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Only delivery agents can update availability."
    });
  }

  const validStatuses = ["online", "offline", "busy", "unavailable"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status. Must be one of: " + validStatuses.join(", ")
    });
  }

  try {
    const dispatchProfile = await DispatchProfile.findOneAndUpdate(
      { user: _id },
      { 
        "availability.status": status,
        lastActiveAt: new Date()
      },
      { new: true }
    );

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Dispatch profile not found"
      });
    }

    res.json({
      success: true,
      message: `Availability updated to ${status}`,
      data: {
        status: status,
        lastActiveAt: dispatchProfile.lastActiveAt
      }
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to update availability");
  }

});

module.exports = updateAvailability;
