const asyncHandler = require("express-async-handler");
const SupportRequest = require("../../models/supportRequestModel");

// What the requester sees. Contact details and staff ids stay out.
const USER_FIELDS = "reference status message response respondedAt resolvedAt createdAt updatedAt -_id";

/**
 * @function listMySupportRequests
 * @description The signed-in user's support requests, newest first. Only
 *              requests sent while signed in are linked to the account; guests
 *              hear back by email only.
 *
 * @query {string} [status] - open | in_progress | resolved
 * @query {number} [page=1]
 * @query {number} [limit=20] - max 50
 */
const listMySupportRequests = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = { user: req.user._id };
  if (req.query.status !== undefined) {
    if (!SupportRequest.STATUSES.includes(req.query.status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${SupportRequest.STATUSES.join(", ")}`,
      });
    }
    filter.status = req.query.status;
  }

  const [requests, total] = await Promise.all([
    SupportRequest.find(filter, USER_FIELDS).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SupportRequest.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      requests,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
        hasMore: skip + requests.length < total,
      },
    },
  });
});

/**
 * @function getMySupportRequest
 * @description One of the signed-in user's support requests by reference.
 *              Someone else's reference is a 404, same as an unknown one.
 *
 * @param {string} reference - e.g. "SR-7K2Q9XHD"
 */
const getMySupportRequest = asyncHandler(async (req, res) => {
  const reference = String(req.params.reference).trim().toUpperCase();
  const request = await SupportRequest.findOne(
    { reference, user: req.user._id },
    USER_FIELDS,
  ).lean();
  if (!request) {
    return res.status(404).json({ success: false, message: "Support request not found" });
  }
  res.json({ success: true, data: request });
});

module.exports = { listMySupportRequests, getMySupportRequest, USER_FIELDS };
