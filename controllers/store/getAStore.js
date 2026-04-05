const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function getAStore
 * @description Get a single store by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Store ID (required)
 * @returns {Object} - Store information
 * @throws {Error} - Throws error if store not found or retrieval fails
 */
const getAStore = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);
  const store = await Store.findById(id);
  if (!store) {
    return res.status(404).json({ success: false, message: "Store not found" });
  }
  res.json(store);
});

module.exports = getAStore;
