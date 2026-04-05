const Order = require("../../models/orderModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");

/**
 * @function updateOrderStatus
 * @description Update the status of an order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Order ID (required)
 * @param {string} req.body.status - New order status (required)
 * @returns {Object} - Updated order information
 * @throws {Error} - Throws error if validation fails or order update fails
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.body;
  validateMongodbId(id);
  try {
    const updatedOrderStatus = await Order.findByIdAndUpdate(
      id,
      {
        orderStatus: status,
      },
      { new: true }
    );
    res.json(updatedOrderStatus);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = updateOrderStatus;
