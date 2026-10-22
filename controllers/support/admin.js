const asyncHandler = require("express-async-handler");
const SupportRequest = require("../../models/supportRequestModel");
const sendEmail = require("../emailController");
const Validate = require("../../Helpers/Validate");
const audit = require("../../services/auditService");
const { escapeHtml } = require("./createSupportRequest");

const RESPONSE_MAX = 2000;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @function listSupportRequests
 * @description All support requests for the support team, newest first.
 * @access Admin only
 *
 * @query {string} [status] - open | in_progress | resolved
 * @query {string} [search] - reference, email or name (partial, case-insensitive)
 * @query {number} [page=1]
 * @query {number} [limit=20] - max 100
 */
const listSupportRequests = asyncHandler(async (req, res) => {
  const { status, search } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const filter = {};
  if (status !== undefined) {
    if (!SupportRequest.STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of: ${SupportRequest.STATUSES.join(", ")}`,
      });
    }
    filter.status = status;
  }
  if (Validate.string(search)) {
    const pattern = new RegExp(escapeRegex(search.trim()), "i");
    filter.$or = [
      { reference: pattern },
      { email: pattern },
      { firstName: pattern },
      { lastName: pattern },
    ];
  }

  const [requests, total, open, inProgress] = await Promise.all([
    SupportRequest.find(filter)
      .populate("user", "fullName email")
      .populate("respondedBy", "fullName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    SupportRequest.countDocuments(filter),
    SupportRequest.countDocuments({ status: "open" }),
    SupportRequest.countDocuments({ status: "in_progress" }),
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
      counts: { open, inProgress },
    },
  });
});

/**
 * @function updateSupportRequest
 * @description Reply to and/or change the status of a support request. A
 *              reply is stored on the request (the user sees it via
 *              GET /api/support/requests/:reference) and emailed to the
 *              address on the request. Replying to an `open` request without a
 *              status moves it to `in_progress`.
 * @access Admin only
 *
 * @param {string} reference
 * @body {string} [response] - 1–2000 characters
 * @body {string} [status]   - open | in_progress | resolved
 */
const updateSupportRequest = asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  let { response } = req.body || {};

  if (status === undefined && response === undefined) {
    return res.status(400).json({ success: false, message: "Send a response, a status, or both" });
  }
  if (status !== undefined && !SupportRequest.STATUSES.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `status must be one of: ${SupportRequest.STATUSES.join(", ")}`,
    });
  }
  if (response !== undefined) {
    if (!Validate.string(response)) {
      return res.status(400).json({ success: false, message: "response must be a non-empty string" });
    }
    response = response.trim();
    if (response.length > RESPONSE_MAX) {
      return res.status(400).json({
        success: false,
        message: `response must be at most ${RESPONSE_MAX} characters`,
      });
    }
  }

  const reference = String(req.params.reference).trim().toUpperCase();
  const request = await SupportRequest.findOne({ reference });
  if (!request) {
    return res.status(404).json({ success: false, message: "Support request not found" });
  }

  const before = { status: request.status };
  if (response !== undefined) {
    request.response = response;
    request.respondedAt = new Date();
    request.respondedBy = req.user._id;
  }
  const nextStatus = status ?? (response !== undefined && request.status === "open" ? "in_progress" : request.status);
  if (nextStatus !== request.status) {
    request.status = nextStatus;
    request.resolvedAt = nextStatus === "resolved" ? new Date() : null;
  }
  await request.save();

  audit.log({
    action: "admin.support_request.updated",
    actor: audit.actor(req),
    resource: { type: "support_request", id: request._id, displayName: request.reference },
    changes: { before, after: { status: request.status } },
    metadata: { responded: response !== undefined },
  });

  if (response !== undefined) {
    const resolvedLine =
      request.status === "resolved"
        ? "<p>We've marked this request as resolved. If you still need help, send a new request and quote this reference.</p>"
        : "";
    sendEmail(
      {
        to: request.email,
        subject: `Update on your support request (${request.reference})`,
        htm: `
          <p>Hello ${escapeHtml(request.firstName)},</p>
          <p>WigoMarket support has replied to your request <strong>${request.reference}</strong>:</p>
          <blockquote>${escapeHtml(response).replace(/\n/g, "<br>")}</blockquote>
          ${resolvedLine}
        `,
      },
      true,
    ).catch((err) => console.error(`[Support] reply email for ${request.reference} failed:`, err));
  }

  res.json({ success: true, message: "Support request updated", data: request });
});

module.exports = { listSupportRequests, updateSupportRequest };
