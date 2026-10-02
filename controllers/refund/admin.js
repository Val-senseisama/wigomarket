/**
 * Admin side of refund requests: the final say on escalations, and the
 * dead-letter queue for payouts that could not complete on their own.
 */
const mongoose = require("mongoose");
const Refund = require("../../models/refundModel");
const audit = require("../../services/auditService");
const service = require("../../services/orderRefundService");
const { serializeRefund } = require("../../utils/refundSerializer");
const { handle, parseStatuses, parsePaging } = require("./handle");

const { REFUND_STATUS: RS } = service;

/** GET /api/admin/refund-requests */
const listRefundRequests = handle(async (req, res) => {
  const { rows, pagination } = await service.listRefunds(
    {},
    { statuses: parseStatuses(req.query.status), ...parsePaging(req.query) },
  );
  const [escalated, needsReview, failed] = await Promise.all([
    Refund.countDocuments({ status: RS.ESCALATED }),
    Refund.countDocuments({ status: RS.NEEDS_REVIEW }),
    Refund.countDocuments({ status: RS.FAILED }),
  ]);
  res.json({
    success: true,
    data: {
      refunds: rows.map((r) => serializeRefund(r, "admin")),
      pagination,
      // The three queues that need an admin.
      counts: { escalated, needsReview, failed },
    },
  });
});

/** GET /api/admin/refund-requests/:id */
const getRefundRequest = handle(async (req, res) => {
  const refund = mongoose.isValidObjectId(req.params.id)
    ? await Refund.findById(req.params.id)
        .populate("order", "orderNumber")
        .populate("store", "name")
        .populate("buyer", "fullName firstname lastname")
    : null;
  if (!refund) return res.status(404).json({ success: false, message: "Refund request not found" });
  res.json({ success: true, data: { refund: serializeRefund(refund, "admin") } });
});

/** POST /api/admin/refund-requests/:id/decision — { decision: approve|decline, note } */
const decideRefundRequest = handle(async (req, res) => {
  const refund = await service.adminDecide(req.params.id, {
    decision: req.body?.decision,
    note: req.body?.note,
    actor: audit.actor(req),
  });
  res.json({ success: true, data: { refund: serializeRefund(refund, "admin") } });
});

/** POST /api/admin/refund-requests/:id/resolve — { outcome, providerRefundId?, note? } */
const resolveRefundRequest = handle(async (req, res) => {
  const { outcome, providerRefundId, note } = req.body || {};
  const refund = await service.resolveRefund(req.params.id, { outcome, providerRefundId, note }, audit.actor(req));
  audit.log({
    action: "refund.resolved",
    actor: audit.actor(req),
    resource: { type: "order", id: refund.order },
    metadata: { refundId: req.params.id, outcome, providerRefundId, note, status: refund.status },
  });
  res.json({ success: true, data: { refund: serializeRefund(refund, "admin") } });
});

module.exports = {
  listRefundRequests,
  getRefundRequest,
  decideRefundRequest,
  resolveRefundRequest,
};
