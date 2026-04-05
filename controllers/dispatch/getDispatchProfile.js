const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function getDispatchProfile
 * @description Get dispatch profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @returns {Object} - Dispatch profile data
 */
const getDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  try {
    const dispatchProfile = await DispatchProfile.findOne({ user: _id })
      .populate('user', 'fullName email mobile');

    if (!dispatchProfile) {
      return res.status(404).json({
        success: false,
        message: "Dispatch profile not found"
      });
    }

    res.json({
      success: true,
      data: dispatchProfile
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to get dispatch profile");
  }

});

module.exports = getDispatchProfile;
