const Refund = require("../models/refundModel");

const { REFUND_STATUS: RS, REFUND_REASONS } = Refund;

/**
 * What each viewer sees as the request's status. The payout steps are an
 * internal detail to buyers and sellers ("Refund in progress"); admins see
 * every state because some need them to act.
 */
const LABELS = {
  [RS.REQUESTED]: "Awaiting seller",
  [RS.REJECTED]: "Rejected by seller",
  [RS.ESCALATED]: "Under review by WigoMarket",
  [RS.DECLINED]: "Declined",
  [RS.WITHDRAWN]: "Withdrawn",
  [RS.APPROVED]: "Refund in progress",
  [RS.PROCESSING]: "Refund in progress",
  [RS.PROVIDER_SUCCEEDED]: "Refund in progress",
  [RS.FAILED]: "Refund in progress",
  [RS.NEEDS_REVIEW]: "Refund in progress",
  [RS.SETTLED]: "Refunded",
};

const ADMIN_LABELS = {
  ...LABELS,
  [RS.APPROVED]: "Approved, awaiting payout",
  [RS.PROCESSING]: "Sending to Flutterwave",
  [RS.PROVIDER_SUCCEEDED]: "Refunded, booking pending",
  [RS.FAILED]: "Rejected by Flutterwave",
  [RS.NEEDS_REVIEW]: "Needs manual review",
};

/** Actions this viewer may take on the request right now. */
const allowedActionsFor = (refund, role, now = new Date()) => {
  const s = refund.status;
  if (role === "buyer") {
    const actions = [];
    if (s === RS.REJECTED || (s === RS.REQUESTED && now > new Date(refund.respondBy))) actions.push("escalate");
    if ([RS.REQUESTED, RS.REJECTED, RS.ESCALATED].includes(s)) actions.push("withdraw");
    return actions;
  }
  if (role === "seller") return s === RS.REQUESTED ? ["approve", "reject"] : [];
  if (role === "admin") {
    if (s === RS.ESCALATED) return ["approve", "decline"];
    if (s === RS.NEEDS_REVIEW) return ["resolve_refunded", "resolve_not_refunded"];
    if (s === RS.FAILED) return ["retry"];
  }
  return [];
};

const idOf = (ref) => (ref && ref._id ? ref._id : ref) ?? null;

const personName = (p) => {
  if (!p || typeof p !== "object") return null;
  if (p.fullName) return p.fullName;
  return [p.firstname, p.lastname].filter(Boolean).join(" ") || null;
};

/**
 * Shape a Refund for a given viewer. Populated order/store/buyer refs are used
 * when present (list endpoints populate them).
 *
 * @param {Object} refund
 * @param {"buyer"|"seller"|"admin"} role
 */
const serializeRefund = (refund, role) => {
  const r = typeof refund.toObject === "function" ? refund.toObject() : refund;
  const base = {
    id: r._id,
    orderId: idOf(r.order),
    orderNumber: r.order?.orderNumber ? `#${r.order.orderNumber}` : null,
    store: { id: idOf(r.store), name: r.store?.name ?? null },
    buyer: { id: idOf(r.buyer), name: personName(r.buyer) },
    items: (r.items || []).map((i) => ({
      productId: i.product,
      title: i.title,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    amount: r.amount,
    currency: r.currency,
    reason: r.reason,
    reasonLabel: REFUND_REASONS[r.reason] ?? r.reason,
    details: r.details ?? null,
    status: r.status,
    statusLabel: (role === "admin" ? ADMIN_LABELS : LABELS)[r.status] ?? r.status,
    respondBy: r.respondBy,
    sellerResponse: r.sellerResponse?.decision
      ? { decision: r.sellerResponse.decision, note: r.sellerResponse.note ?? null, at: r.sellerResponse.at }
      : null,
    escalation: r.escalation?.at ? { note: r.escalation.note ?? null, at: r.escalation.at } : null,
    adminDecision: r.adminDecision?.decision
      ? { decision: r.adminDecision.decision, note: r.adminDecision.note ?? null, at: r.adminDecision.at }
      : null,
    approvedBy: r.approvedBy ?? null,
    settledAt: r.settledAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    allowedActions: allowedActionsFor(r, role),
  };

  if (role === "seller" || role === "admin") {
    base.vendorAmount = r.vendorAmount; // what comes out of the seller's wallet
    base.platformAmount = r.platformAmount;
  }
  if (role === "admin") {
    Object.assign(base, {
      sellerId: r.seller,
      providerTransactionId: r.providerTransactionId,
      providerRefundId: r.providerRefundId ?? null,
      lastError: r.lastError ?? null,
      attempts: r.attempts,
      shortfalls: r.shortfalls || [],
      ledgerTransactionId: r.ledgerTransactionId ?? null,
      history: r.history || [],
    });
  } else {
    base.history = (r.history || [])
      .filter((h) => !["processing", "provider_succeeded", "failed", "needs_review"].includes(h.status))
      .map((h) => ({ status: h.status, at: h.at, note: h.note ?? null, role: h.role ?? null }));
  }
  return base;
};

module.exports = { serializeRefund, allowedActionsFor };
