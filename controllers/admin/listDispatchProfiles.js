const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");

/**
 * @function listDispatchProfiles
 * @description Paginated list of dispatch (rider) profiles for review.
 * @access Admin only
 *
 * Query params (all optional):
 *   status — pending | approved | rejected | suspended
 *   page   — default 1
 *   limit  — default 20, max 100
 */
const listDispatchProfiles = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  if (status) filter.status = status;

  const [profiles, total] = await Promise.all([
    DispatchProfile.find(filter)
      .populate("user", "fullName email mobile status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    DispatchProfile.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      profiles,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasMore: skip + profiles.length < total,
      },
    },
  });
});

module.exports = listDispatchProfiles;
