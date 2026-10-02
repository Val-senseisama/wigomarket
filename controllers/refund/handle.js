const asyncHandler = require("express-async-handler");
const { RefundError } = require("../../services/orderRefundService");

/** asyncHandler that turns a RefundError into its HTTP status + message. */
const handle = (fn) =>
  asyncHandler(async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      if (err instanceof RefundError) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      throw err;
    }
  });

/** ?status=a,b or repeated keys → string[] */
const parseStatuses = (raw) =>
  (Array.isArray(raw) ? raw : [raw])
    .filter((v) => v != null)
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter(Boolean);

const parsePaging = (query, defaultLimit = 20) => ({
  page: Math.max(1, parseInt(query.page, 10) || 1),
  limit: Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit)),
});

module.exports = { handle, parseStatuses, parsePaging };
