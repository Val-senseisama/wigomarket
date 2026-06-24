const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const { getOrderDetail } = require("../../services/orderQueryService");

/**
 * @function getStoreOrderDetail
 * @description Full order detail for the seller's order-details screen. Scoped to
 *   orders that contain a product from the logged-in seller's store.
 * @access Seller (isSeller sets req.store)
 */
const getStoreOrderDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  if (!req.store) {
    return res
      .status(404)
      .json({ success: false, message: "No store found for this account" });
  }

  const detail = await getOrderDetail(id, { "products.store": req.store });
  if (!detail) {
    return res.status(404).json({
      success: false,
      message: "Order not found or does not belong to your store",
    });
  }

  res.json({ success: true, data: detail });
});

module.exports = getStoreOrderDetail;
