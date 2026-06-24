const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../../utils/validateMongodbId");
const { getOrderDetail } = require("../../services/orderQueryService");

/**
 * @function getOrderDetail
 * @description Full order detail for the admin order-details screen (any order).
 * @access Admin only
 */
const getOrderDetailAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const detail = await getOrderDetail(id);
  if (!detail) {
    return res
      .status(404)
      .json({ success: false, message: "Order not found" });
  }

  res.json({ success: true, data: detail });
});

module.exports = getOrderDetailAdmin;
