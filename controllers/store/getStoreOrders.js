const asyncHandler = require("express-async-handler");
const { listOrders } = require("../../services/orderQueryService");

/**
 * @function getStoreOrders
 * @description Paginated, filterable order list for the logged-in seller's store.
 *              Scoped to orders that contain at least one product from this store.
 * @access Seller only (isSeller sets req.store)
 *
 * Query params (all optional):
 *   category  — recent | ongoing | history   (default recent)
 *   status    — display status (Pending, Confirmed, Preparing, Pick up Ready, In Transit, Delivered, Cancelled)
 *   orderType — "Pick up" | "Delivery"
 *   dateFrom  — ISO date (inclusive lower bound on order date)
 *   dateTo    — ISO date (inclusive upper bound on order date)
 *   search    — matches order number or customer name
 *   sortBy    — date | amount   (default date)
 *   sortOrder — asc | desc      (default desc)
 *   page      — default 1
 *   limit     — default 10, max 100
 */
const getStoreOrders = asyncHandler(async (req, res) => {
  if (!req.store) {
    return res.status(404).json({
      success: false,
      message: "No store found for this account",
    });
  }

  const result = await listOrders({
    baseFilter: { "products.store": req.store },
    query: req.query,
  });

  res.json({ success: true, data: result });
});

module.exports = getStoreOrders;
