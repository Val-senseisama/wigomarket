const asyncHandler = require("express-async-handler");
const { listOrders } = require("../../services/orderQueryService");

/**
 * @function listOrders
 * @description Paginated, filterable order list across all stores for admins.
 * @access Admin only
 *
 * Query params: same contract as the seller order list — category, status,
 * orderType, dateFrom, dateTo, search, sortBy, sortOrder, page, limit.
 */
const listAllOrders = asyncHandler(async (req, res) => {
  const result = await listOrders({ baseFilter: {}, query: req.query });
  res.json({ success: true, data: result });
});

module.exports = listAllOrders;
