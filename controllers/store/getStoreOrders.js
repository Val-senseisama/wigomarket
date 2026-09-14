const asyncHandler = require("express-async-handler");
const { listOrders, OrderQueryError } = require("../../services/orderQueryService");

/**
 * @function getStoreOrders
 * @description Paginated, filterable order list for the logged-in seller's store.
 *              Scoped to orders that contain at least one product from this store.
 * @access Seller only (isSeller sets req.store)
 *
 * Query params (all optional):
 *   category  — all | pending | ongoing | history   (default all; matches the
 *               keys of `counts`. "recent" is a deprecated alias of all)
 *   status    — one or more statuses: repeat the key (?status=pending&status=confirmed)
 *               or comma-separate (?status=pending,confirmed). Canonical tokens
 *               (pickUpReady), display labels (Pick up Ready) or legacy values.
 *               Unknown values → 400.
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

  try {
    const result = await listOrders({
      baseFilter: { "products.store": req.store },
      query: req.query,
      // Each row carries allowedActions for the table's "Update Status" menu.
      role: "seller",
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

module.exports = getStoreOrders;
