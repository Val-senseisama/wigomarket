const asyncHandler = require("express-async-handler");
const User = require("../../models/userModel");

/**
 * @function listUsers
 * @description Paginated, filterable list of users for admin management.
 * @access Admin only
 *
 * Query params (all optional):
 *   role    — seller | buyer | dispatch | admin
 *   status  — active | pending | blocked
 *   search  — partial match on email, fullName, firstname, lastname, mobile
 *   page    — default 1
 *   limit   — default 20, max 100
 */
const listUsers = asyncHandler(async (req, res) => {
  const { role, status, search } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    const rx = { $regex: search, $options: "i" };
    filter.$or = [
      { email: rx },
      { fullName: rx },
      { firstname: rx },
      { lastname: rx },
      { mobile: rx },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select("-password -refreshToken")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      users,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasMore: skip + users.length < total,
      },
    },
  });
});

module.exports = listUsers;
