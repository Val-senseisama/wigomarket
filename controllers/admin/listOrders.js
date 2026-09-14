const asyncHandler = require("express-async-handler");
const { listOrders, OrderQueryError } = require("../../services/orderQueryService");

/**
 * @function listOrders
 * @description Paginated, filterable order list across all stores for admins.
 * @access Admin only
 *
 * Query params: same contract as the seller order list — category, status,
 * orderType, dateFrom, dateTo, search, sortBy, sortOrder, page, limit.
 */
const listAllOrders = asyncHandler(async (req, res) => {
  try {
    const result = await listOrders({
      baseFilter: {},
      query: req.query,
      role: "admin",
    });
    res.json({ success: true, data: result });
  } catch (err) {
    if (err instanceof OrderQueryError) {
      return res
        .status(err.statusCode)
        .json({ success: false, message: err.message });
    }
    throw err;
  }
});

module.exports = listAllOrders;
