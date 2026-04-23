const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function createDispatchProfile
 * @description Create dispatch profile for delivery agent
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Dispatch profile data
 * @returns {Object} - Created dispatch profile
 */
const createDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { vehicleInfo, coverageAreas, documents, workingDays } = req.body;

  // Verify user is a delivery agent
  if (!req.userRoles.includes("dispatch")) {
    return res.status(403).json({
      success: false,
      message:
        "Access denied. Only delivery agents can create dispatch profiles.",
    });
  }

  // Check if profile already exists
  const existingProfile = await DispatchProfile.findOne({ user: _id });
  if (existingProfile) {
    return res.status(400).json({
      success: false,
      message: "Dispatch profile already exists for this user",
    });
  }

  try {
    const dispatchProfile = await DispatchProfile.create({
      user: _id,
      vehicleInfo: {
        type: vehicleInfo.type,
        make: vehicleInfo.make,
        model: vehicleInfo.model,
        year: vehicleInfo.year,
        plateNumber: vehicleInfo.plateNumber,
        color: vehicleInfo.color,
      },
      coverageAreas: coverageAreas || [],
      documents: {
        driverLicense: {
          number: documents.driverLicense.number,
          expiryDate: documents.driverLicense.expiryDate,
          image: documents.driverLicense.image,
        },
        vehicleRegistration: {
          number: documents.vehicleRegistration.number,
          expiryDate: documents.vehicleRegistration.expiryDate,
          image: documents.vehicleRegistration.image,
        },
        nin: {
          number: documents.nin.number,
          image: documents.nin.image,
        },
      },
      availability: {
        workingDays: workingDays || [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
        ],
      },
      status: "pending",
    });

    res.json({
      success: true,
      message: "Dispatch profile created successfully",
      data: dispatchProfile,
    });
  } catch (error) {
    console.log(error);
    throw new Error(error.message || "Failed to create dispatch profile");
  }
});

module.exports = createDispatchProfile;
