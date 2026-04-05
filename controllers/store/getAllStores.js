const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");

/**
 * @function getAllStores
 * @description Get all stores with selected fields
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Array} - Array of store objects with selected fields
 * @throws {Error} - Throws error if retrieval fails
 */
const getAllStores = asyncHandler(async (req, res) => {
  try {
    const getStores = await Store.find().select('name image email mobile address');
    res.json(getStores);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getAllStores;
