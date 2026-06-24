const asyncHandler = require("express-async-handler");
const Store = require("../../models/storeModel");
const {
  contactCustomer,
  OrderContactError,
} = require("../../services/orderContactService");

/**
 * @function contactCustomer
 * @description Send a direct message to the buyer who placed an order. Scoped to
 *   orders that contain a product from the logged-in seller's store, so a seller
 *   can only message their own customers.
 * @access Seller (isSeller sets req.store)
 * @param {string} req.params.id    - Order ID
 * @param {string} req.body.message - Free-text message to the buyer
 */
const contactCustomerStore = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;

  if (!req.store) {
    return res
      .status(404)
      .json({ success: false, message: "No store found for this account" });
  }

  const store = await Store.findById(req.store).select("name");

  try {
    const result = await contactCustomer({
      orderId: id,
      message,
      scopeFilter: { "products.store": req.store },
      senderName: store?.name,
      req,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof OrderContactError) {
      // An out-of-scope order reads as "not found" to the service; phrase it as
      // an ownership error for sellers.
      const message =
        error.statusCode === 404
          ? "Order not found or does not belong to your store"
          : error.message;
      return res
        .status(error.statusCode)
        .json({ success: false, message });
    }
    throw error;
  }
});

module.exports = contactCustomerStore;
