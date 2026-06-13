const asyncHandler = require("express-async-handler");
const Store = require("../../models/storeModel");

/**
 * @function listStores
 * @description Paginated, status-filterable list of stores for admin review.
 * @access Admin only
 *
 * Query params (all optional):
 *   status — pending | active | suspended
 *   search — partial match on store name
 *   page   — default 1
 *   limit  — default 20, max 100
 */
const listStores = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  if (status) filter.status = status;
  if (search) filter.name = { $regex: search, $options: "i" };

  const [stores, total] = await Promise.all([
    Store.find(filter)
      .populate("owner", "fullName email mobile")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Store.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      stores,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasMore: skip + stores.length < total,
      },
    },
  });
});

module.exports = listStores;
