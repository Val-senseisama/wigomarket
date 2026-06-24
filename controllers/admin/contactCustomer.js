const asyncHandler = require("express-async-handler");
const {
  contactCustomer,
  OrderContactError,
} = require("../../services/orderContactService");

/**
 * @function contactCustomer
 * @description Send a direct message to the buyer who placed any order.
 * @access Admin only
 * @param {string} req.params.id    - Order ID
 * @param {string} req.body.message - Free-text message to the buyer
 */
const contactCustomerAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  try {
    const result = await contactCustomer({
      orderId: id,
      message,
      senderName: "WigoMarket",
      req,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof OrderContactError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    throw error;
  }
});

module.exports = contactCustomerAdmin;
