const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");

/**
 * @function getMyStore
 * @description Get the current user's store
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - User ID
 * @returns {Object} - User's store information
 * @throws {Error} - Throws error if store not found or retrieval fails
 */
const getMyStore = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  try {
    const myStore = await Store.findOne({ owner: _id });
    res.json(myStore);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getMyStore;
