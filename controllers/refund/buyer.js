/**
 * Buyer side of refund requests: a buyer asks the seller for a refund of that
 * seller's items, and can withdraw or escalate it. See services/orderRefundService.
 */
const mongoose = require("mongoose");
const Refund = require("../../models/refundModel");
const audit = require("../../services/auditService");
const service = require("../../services/orderRefundService");
const { serializeRefund } = require("../../utils/refundSerializer");
const { handle, parseStatuses, parsePaging } = require("./handle");

const notFound = (res) => res.status(404).json({ success: false, message: "Order not found" });

/** GET /api/order/:id/refundable — what can still be refunded, per seller. */
const getRefundable = handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
  const data = await service.getRefundableItems(req.params.id, req.user._id);
  res.json({ success: true, data });
});

/** POST /api/order/:id/refund-requests */
const createRefundRequest = handle(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return notFound(res);
  const { storeId, items, reason, details } = req.body || {};
  const refund = await service.createRefundRequest({
    orderId: req.params.id,
    buyerId: req.user._id,
    storeId,
    items,
    reason,
    details,
    actor: audit.actor(req),
  });
  res.status(201).json({ success: true, data: { refund: serializeRefund(refund, "buyer") } });
});

/** GET /api/order/refund-requests — the buyer's requests, optionally for one order. */
const listMyRefundRequests = handle(async (req, res) => {
  const filter = { buyer: req.user._id };
  if (req.query.orderId) {
    if (!mongoose.isValidObjectId(req.query.orderId)) {
      return res.status(400).json({ success: false, message: "Invalid orderId" });
    }
    filter.order = req.query.orderId;
  }
  const { rows, pagination } = await service.listRefunds(filter, {
    statuses: parseStatuses(req.query.status),
    ...parsePaging(req.query),
  });
  res.json({ success: true, data: { refunds: rows.map((r) => serializeRefund(r, "buyer")), pagination } });
});

/** GET /api/order/refund-requests/:requestId */
const getMyRefundRequest = handle(async (req, res) => {
  const refund = mongoose.isValidObjectId(req.params.requestId)
    ? await Refund.findOne({ _id: req.params.requestId, buyer: req.user._id })
        .populate("order", "orderNumber")
        .populate("store", "name")
    : null;
  if (!refund) return res.status(404).json({ success: false, message: "Refund request not found" });
  res.json({ success: true, data: { refund: serializeRefund(refund, "buyer") } });
});

/** POST /api/order/refund-requests/:requestId/escalate */
const escalateRefundRequest = handle(async (req, res) => {
  const refund = await service.escalate(req.params.requestId, req.user._id, {
    note: req.body?.note,
    actor: audit.actor(req),
  });
  res.json({ success: true, data: { refund: serializeRefund(refund, "buyer") } });
});

/** POST /api/order/refund-requests/:requestId/withdraw */
const withdrawRefundRequest = handle(async (req, res) => {
  const refund = await service.withdraw(req.params.requestId, req.user._id, { actor: audit.actor(req) });
  res.json({ success: true, data: { refund: serializeRefund(refund, "buyer") } });
});

module.exports = {
  getRefundable,
  createRefundRequest,
  listMyRefundRequests,
  getMyRefundRequest,
  escalateRefundRequest,
  withdrawRefundRequest,
};
