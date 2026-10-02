/**
 * Seller side of refund requests: review and approve or reject buyers'
 * requests for this store's items. Approving sends the refund to the buyer's
 * card and takes the seller's share back out of their wallet.
 */
const mongoose = require("mongoose");
const Refund = require("../../models/refundModel");
const audit = require("../../services/auditService");
const service = require("../../services/orderRefundService");
const { serializeRefund } = require("../../utils/refundSerializer");
const { handle, parseStatuses, parsePaging } = require("./handle");

const noStore = (res) => res.status(404).json({ success: false, message: "No store found for this account" });

/** GET /api/store/refund-requests */
const listStoreRefundRequests = handle(async (req, res) => {
  if (!req.store) return noStore(res);
  const { rows, pagination } = await service.listRefunds(
    { store: req.store },
    { statuses: parseStatuses(req.query.status), ...parsePaging(req.query) },
  );
  const awaitingResponse = await Refund.countDocuments({ store: req.store, status: service.REFUND_STATUS.REQUESTED });
  res.json({
    success: true,
    data: { refunds: rows.map((r) => serializeRefund(r, "seller")), pagination, counts: { awaitingResponse } },
  });
});

/** GET /api/store/refund-requests/:id */
const getStoreRefundRequest = handle(async (req, res) => {
  if (!req.store) return noStore(res);
  const refund = mongoose.isValidObjectId(req.params.id)
    ? await Refund.findOne({ _id: req.params.id, store: req.store })
        .populate("order", "orderNumber")
        .populate("store", "name")
        .populate("buyer", "fullName firstname lastname")
    : null;
  if (!refund) return res.status(404).json({ success: false, message: "Refund request not found" });
  res.json({ success: true, data: { refund: serializeRefund(refund, "seller") } });
});

/** POST /api/store/refund-requests/:id/approve */
const approveRefundRequest = handle(async (req, res) => {
  if (!req.store) return noStore(res);
  const refund = await service.sellerApprove(req.params.id, req.store, {
    note: req.body?.note,
    actor: audit.actor(req),
  });
  res.json({ success: true, data: { refund: serializeRefund(refund, "seller") } });
});

/** POST /api/store/refund-requests/:id/reject */
const rejectRefundRequest = handle(async (req, res) => {
  if (!req.store) return noStore(res);
  const refund = await service.sellerReject(req.params.id, req.store, {
    note: req.body?.reason ?? req.body?.note,
    actor: audit.actor(req),
  });
  res.json({ success: true, data: { refund: serializeRefund(refund, "seller") } });
});

module.exports = {
  listStoreRefundRequests,
  getStoreRefundRequest,
  approveRefundRequest,
  rejectRefundRequest,
};
