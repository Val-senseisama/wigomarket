/**
 * @file orderRefundService.js
 * @description Buyer → seller refund requests, and paying approved refunds
 *              back to the buyer's card. See models/refundModel for the states.
 *
 * Money is routed to sellers as soon as an order is paid, so a refund is the
 * seller's to grant: the buyer asks the seller for a refund of that seller's
 * items, the seller approves or rejects, and a rejected (or ignored) request
 * can be escalated to an admin whose decision is final.
 *
 * Amount: the buyer gets back what they paid for the items (listed price).
 * The seller's wallet gives back their share (vendor price) and the platform
 * returns its margin, so a seller is never charged for money they never got.
 * The delivery fee is not refunded. Refunded items are not restocked.
 *
 * Paying out an approved refund, and why the steps are separate:
 *
 *   1. Claim    — `approved → processing` with a guarded update, so only one
 *                 caller ever talks to the provider for a given request. The
 *                 claim also fixes this attempt's `providerRefundReference`.
 *   2. Provider — the provider that took the original charge is called
 *                 *outside* any Mongo transaction (a withTransaction callback
 *                 retries, which would re-send a billed refund). The outcome is
 *                 persisted at once. A pending or unknown outcome is never
 *                 re-sent: where the provider can be asked about our refund
 *                 reference (Monnify) the cron asks until it is final; where it
 *                 cannot (Flutterwave — no idempotency key) it goes to
 *                 `needs_review`, since a blind retry could pay the buyer twice.
 *   3. Settle   — one Mongo transaction books it: claws the seller's share
 *                 back from their wallet, writes the balanced refund ledger and
 *                 updates the order's payment status. Internal and idempotent,
 *                 so the cron retries it until it succeeds or is dead-lettered.
 *
 * A seller who already withdrew the money cannot block a refund the buyer has
 * already received: whatever the wallet holds is recovered, the rest is booked
 * as owed by the seller (accounts_receivable) and admins are alerted.
 */

const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Refund = require("../models/refundModel");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const payments = require("./payments");
const { PaymentStatus } = require("../utils/constants");
const { STATUS } = require("../utils/orderStatus");
const money = require("../utils/money");
const { MakeID } = require("../Helpers/Helpers");
const { unitPrice, unitListedPrice } = require("./commissionService");
const { storeRefundEntries, withWalletShortfalls } = require("./orderPaymentLedger");
const audit = require("./auditService");
const { notifyAdmins } = require("./alertService");
const notify = require("./refundNotificationService");

const { REFUND_STATUS: RS, CLOSED_STATUSES, REFUND_REASONS } = Refund;

// How long a seller has to answer before the buyer may escalate.
const SELLER_RESPONSE_DAYS = 3;
// How long after delivery a refund may be requested.
const REFUND_WINDOW_DAYS = 7;
// A provider refund still pending after this long goes to needs_review.
const PROVIDER_PENDING_MAX_MS = 24 * 60 * 60 * 1000;
// Booking attempts before a paid-out refund is dead-lettered to needs_review.
const MAX_SETTLE_ATTEMPTS = 5;
// A refund still `processing` after this long means the process died mid-call.
const STUCK_PROCESSING_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const REFUNDABLE_PAYMENT_STATUSES = [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED];
const SYSTEM_ACTOR = { userId: null, role: "system", ip: "refund-service" };

/** A refund action that cannot be honoured — surfaced with its status code. */
class RefundError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "RefundError";
    this.statusCode = statusCode;
  }
}

const historyEntry = (status, note, by = null, role = "system") => ({
  status,
  at: new Date(),
  note,
  by,
  role,
});

const idOf = (ref) => (ref && ref._id ? ref._id : ref) ?? null;
const sameId = (a, b) => a != null && b != null && String(idOf(a)) === String(idOf(b));

const findPaymentTransaction = (orderId, session = null) =>
  Transaction.findOne({
    reference: `Payment-${orderId}`,
    type: "order_payment",
    status: "completed",
  }).session(session);

/** When the order was delivered, or null if it has not been. */
const deliveredAt = (order) => {
  if (order.orderStatus !== STATUS.DELIVERED) return null;
  if (order.actualDeliveryTime) return order.actualDeliveryTime;
  const entry = [...(order.statusHistory || [])].reverse().find((h) => h.status === STATUS.DELIVERED);
  return entry?.at ?? order.deliveryMetadata?.deliveredAt ?? order.updatedAt;
};

/** Why this order cannot be refunded at all right now, or null. */
const orderIneligibility = (order, now = new Date()) => {
  if (!REFUNDABLE_PAYMENT_STATUSES.includes(order.paymentStatus)) {
    return order.paymentStatus === PaymentStatus.REFUNDED
      ? "This order has already been fully refunded"
      : "This order has not been paid";
  }
  const delivered = deliveredAt(order);
  if (delivered && now - new Date(delivered) > REFUND_WINDOW_DAYS * DAY_MS) {
    return `Refunds can only be requested within ${REFUND_WINDOW_DAYS} days of delivery`;
  }
  return null;
};

/**
 * Quantity of each product already refunded, or tied up in an open request,
 * for one store's part of an order: Map(productId → quantity).
 */
async function claimedQuantities(orderId, storeId) {
  const refunds = await Refund.find({
    order: orderId,
    store: storeId,
    status: { $nin: [RS.DECLINED, RS.WITHDRAWN] },
  })
    .select("items")
    .lean();
  const claimed = new Map();
  for (const r of refunds) {
    for (const item of r.items) {
      const key = String(item.product);
      claimed.set(key, (claimed.get(key) || 0) + item.quantity);
    }
  }
  return claimed;
}

/** This store's order lines merged per product: [{ product, line, purchased }]. */
const storeLines = (order, storeId) => {
  const byProduct = new Map();
  for (const line of order.products || []) {
    if (!sameId(line.store ?? line.product?.store, storeId)) continue;
    const key = String(idOf(line.product));
    const entry = byProduct.get(key);
    if (entry) entry.purchased += line.count;
    else byProduct.set(key, { product: line.product, line, purchased: line.count });
  }
  return [...byProduct.values()];
};

const loadOrder = (orderId) =>
  Order.findById(orderId).populate("products.product", "title price listedPrice images store");

/**
 * What the buyer can still ask to have refunded, per store — backs the refund
 * request form.
 */
async function getRefundableItems(orderId, buyerId) {
  const order = await loadOrder(orderId);
  if (!order || !sameId(order.orderedBy, buyerId)) throw new RefundError("Order not found", 404);

  const ineligible = orderIneligibility(order);
  const storeIds = [
    ...new Set((order.products || []).map((l) => String(idOf(l.store ?? l.product?.store)))),
  ];
  const stores = await Store.find({ _id: { $in: storeIds } }).select("name").lean();
  const storeName = new Map(stores.map((s) => [String(s._id), s.name]));
  const openRequests = await Refund.find({ order: order._id, open: true }).select("store status").lean();

  const result = [];
  for (const storeId of storeIds) {
    const claimed = await claimedQuantities(order._id, storeId);
    const open = openRequests.find((r) => sameId(r.store, storeId));
    const items = storeLines(order, storeId).map(({ product, line, purchased }) => {
      const refunded = claimed.get(String(idOf(product))) || 0;
      return {
        productId: idOf(product),
        title: product?.title ?? "Deleted product",
        image: product?.images?.[0] ?? null,
        unitPrice: unitListedPrice(line),
        purchased,
        refundedOrRequested: refunded,
        refundable: Math.max(0, purchased - refunded),
      };
    });
    const hasRefundable = items.some((i) => i.refundable > 0);
    result.push({
      storeId,
      storeName: storeName.get(storeId) ?? null,
      items,
      openRequestId: open?._id ?? null,
      canRequest: !ineligible && !open && hasRefundable,
      reason:
        ineligible ||
        (open ? "There is already an open refund request for this seller" : null) ||
        (hasRefundable ? null : "Everything from this seller has already been refunded"),
    });
  }

  return {
    orderId: order._id,
    eligible: !ineligible,
    reason: ineligible,
    refundWindowDays: REFUND_WINDOW_DAYS,
    reasons: Object.entries(REFUND_REASONS).map(([value, label]) => ({ value, label })),
    stores: result,
  };
}

/**
 * Buyer asks a seller to refund some or all of that seller's items.
 *
 * @param {Object} opts
 * @param {string} opts.orderId
 * @param {Object} opts.buyerId
 * @param {string} [opts.storeId]  Required when the order spans several stores.
 * @param {{ productId: string, quantity: number }[]} [opts.items]  Default: everything still refundable.
 * @param {string} opts.reason     A key of REFUND_REASONS.
 * @param {string} [opts.details]
 */
async function createRefundRequest({ orderId, buyerId, storeId, items, reason, details, actor }) {
  if (!REFUND_REASONS[reason]) {
    throw new RefundError(`Invalid reason. Must be one of: ${Object.keys(REFUND_REASONS).join(", ")}`);
  }

  const order = await loadOrder(orderId);
  if (!order || !sameId(order.orderedBy, buyerId)) throw new RefundError("Order not found", 404);

  const ineligible = orderIneligibility(order);
  if (ineligible) throw new RefundError(ineligible, 409);

  const orderStores = [
    ...new Set((order.products || []).map((l) => String(idOf(l.store ?? l.product?.store)))),
  ];
  let targetStore = storeId ? String(storeId) : null;
  if (!targetStore) {
    if (orderStores.length > 1) {
      throw new RefundError("This order has items from several sellers; storeId is required");
    }
    targetStore = orderStores[0];
  }
  if (!orderStores.includes(targetStore)) {
    throw new RefundError("That seller has no items in this order");
  }

  if (await Refund.exists({ order: order._id, store: targetStore, open: true })) {
    throw new RefundError("You already have an open refund request for this seller", 409);
  }

  const store = await Store.findById(targetStore).select("owner").lean();
  if (!store?.owner) throw new RefundError("This seller can no longer be reached; contact support", 409);

  const paymentTx = await findPaymentTransaction(order._id);
  const providerTransactionId = paymentTx?.metadata?.externalTransactionId ?? null;
  // Refunds go back through whichever provider took the charge.
  const provider = paymentTx?.metadata?.paymentMethod;
  if (!paymentTx || !providerTransactionId || !payments.isProvider(provider)) {
    throw new RefundError("This order's payment cannot be refunded automatically; contact support", 409);
  }

  // Resolve the requested quantities against what is still refundable.
  const claimed = await claimedQuantities(order._id, targetStore);
  const lines = storeLines(order, targetStore);
  const available = new Map(
    lines.map((l) => [String(idOf(l.product)), { ...l, refundable: l.purchased - (claimed.get(String(idOf(l.product))) || 0) }]),
  );

  let wanted;
  if (Array.isArray(items) && items.length) {
    const seen = new Set();
    wanted = items.map(({ productId, quantity }) => {
      const key = String(productId);
      const entry = available.get(key);
      if (!entry) throw new RefundError(`Product ${productId} is not one of this seller's items in the order`);
      if (seen.has(key)) throw new RefundError(`Product ${productId} is listed twice`);
      seen.add(key);
      const qty = Number(quantity);
      if (!Number.isInteger(qty) || qty < 1) throw new RefundError("quantity must be a whole number of at least 1");
      if (qty > entry.refundable) {
        throw new RefundError(
          `Only ${entry.refundable} of "${entry.product?.title ?? productId}" can still be refunded`,
        );
      }
      return { entry, qty };
    });
  } else {
    wanted = [...available.values()].filter((e) => e.refundable > 0).map((entry) => ({ entry, qty: entry.refundable }));
  }
  if (!wanted.length) throw new RefundError("Everything from this seller has already been refunded", 409);

  const refundItems = wanted.map(({ entry, qty }) => ({
    product: idOf(entry.product),
    title: entry.product?.title ?? "Deleted product",
    quantity: qty,
    unitPrice: unitListedPrice(entry.line),
    vendorUnitPrice: unitPrice(entry.line),
  }));
  const amount = money.sum(refundItems, (i) => money.multiply(i.unitPrice, i.quantity));
  const vendorAmount = money.sum(refundItems, (i) => money.multiply(i.vendorUnitPrice, i.quantity));
  if (!(amount > 0)) throw new RefundError("These items have no refundable value", 409);

  const _id = new mongoose.Types.ObjectId();
  let refund;
  try {
    refund = await Refund.create({
      _id,
      order: order._id,
      store: targetStore,
      seller: store.owner,
      buyer: order.orderedBy,
      idempotencyKey: `refund:${_id}`,
      items: refundItems,
      amount,
      vendorAmount,
      platformAmount: money.subtract(amount, vendorAmount),
      reason,
      details,
      respondBy: new Date(Date.now() + SELLER_RESPONSE_DAYS * DAY_MS),
      provider,
      providerTransactionId: String(providerTransactionId),
      history: [historyEntry(RS.REQUESTED, REFUND_REASONS[reason], buyerId, "buyer")],
    });
  } catch (err) {
    // Lost a race with a concurrent request: the partial unique index kept it to one.
    if (err.code === 11000) throw new RefundError("You already have an open refund request for this seller", 409);
    throw err;
  }

  audit.log({
    action: "refund.requested",
    actor: actor || SYSTEM_ACTOR,
    resource: { type: "order", id: order._id },
    metadata: { refundId: String(refund._id), store: targetStore, amount, items: refundItems.length },
  });
  await notify.refundRequested(refund);
  return refund;
}

/** Load a request, 404 unless `owns(refund)` holds. */
async function loadOwned(refundId, owns) {
  if (!mongoose.isValidObjectId(refundId)) throw new RefundError("Refund request not found", 404);
  const refund = await Refund.findById(refundId);
  if (!refund || !owns(refund)) throw new RefundError("Refund request not found", 404);
  return refund;
}

/** Guarded transition; throws 409 naming the current status when it lost. */
async function transition(refundId, from, update, verb) {
  const updated = await Refund.findOneAndUpdate(
    { _id: refundId, status: { $in: [].concat(from) } },
    update,
    { new: true },
  );
  if (!updated) {
    const current = await Refund.findById(refundId).select("status").lean();
    throw new RefundError(`Cannot ${verb} a refund request that is ${current?.status ?? "missing"}`, 409);
  }
  return updated;
}

// ── Seller ───────────────────────────────────────────────────────────────────

async function sellerApprove(refundId, storeId, { note, actor } = {}) {
  await loadOwned(refundId, (r) => sameId(r.store, storeId));
  const by = actor?.userId ?? null;
  const refund = await transition(
    refundId,
    RS.REQUESTED,
    {
      $set: {
        status: RS.APPROVED,
        approvedBy: "seller",
        sellerResponse: { decision: "approved", note, by, at: new Date() },
      },
      $push: { history: historyEntry(RS.APPROVED, note || "Approved by seller", by, "seller") },
    },
    "approve",
  );
  audit.log({
    action: "refund.seller_approved",
    actor: actor || SYSTEM_ACTOR,
    resource: { type: "order", id: refund.order },
    metadata: { refundId: String(refundId), amount: refund.amount },
  });
  await notify.refundApproved(refund);
  return processRefund(refundId);
}

async function sellerReject(refundId, storeId, { note, actor } = {}) {
  if (!note || !String(note).trim()) throw new RefundError("A reason is required to reject a refund request");
  await loadOwned(refundId, (r) => sameId(r.store, storeId));
  const by = actor?.userId ?? null;
  const refund = await transition(
    refundId,
    RS.REQUESTED,
    {
      $set: { status: RS.REJECTED, sellerResponse: { decision: "rejected", note, by, at: new Date() } },
      $push: { history: historyEntry(RS.REJECTED, note, by, "seller") },
    },
    "reject",
  );
  audit.log({
    action: "refund.seller_rejected",
    actor: actor || SYSTEM_ACTOR,
    resource: { type: "order", id: refund.order },
    metadata: { refundId: String(refundId), note },
  });
  await notify.refundRejected(refund);
  return refund;
}

// ── Buyer ────────────────────────────────────────────────────────────────────

/** Whether the buyer may escalate right now. */
const canEscalate = (refund, now = new Date()) =>
  refund.status === RS.REJECTED ||
  (refund.status === RS.REQUESTED && now > new Date(refund.respondBy));

async function escalate(refundId, buyerId, { note, actor } = {}) {
  const current = await loadOwned(refundId, (r) => sameId(r.buyer, buyerId));
  if (current.status === RS.REQUESTED && !canEscalate(current)) {
    throw new RefundError(
      `The seller has until ${current.respondBy.toISOString()} to respond before you can escalate`,
      409,
    );
  }
  const refund = await Refund.findOneAndUpdate(
    {
      _id: refundId,
      $or: [
        { status: RS.REJECTED },
        { status: RS.REQUESTED, respondBy: { $lt: new Date() } },
      ],
    },
    {
      $set: { status: RS.ESCALATED, escalation: { note, at: new Date() } },
      $push: { history: historyEntry(RS.ESCALATED, note || "Escalated by buyer", buyerId, "buyer") },
    },
    { new: true },
  );
  if (!refund) throw new RefundError(`Cannot escalate a refund request that is ${current.status}`, 409);

  audit.log({
    action: "refund.escalated",
    actor: actor || SYSTEM_ACTOR,
    resource: { type: "order", id: refund.order },
    metadata: { refundId: String(refundId), note },
  });
  await notify.refundEscalated(refund);
  return refund;
}

async function withdraw(refundId, buyerId, { actor } = {}) {
  await loadOwned(refundId, (r) => sameId(r.buyer, buyerId));
  const refund = await transition(
    refundId,
    [RS.REQUESTED, RS.REJECTED, RS.ESCALATED],
    {
      $set: { status: RS.WITHDRAWN, open: false },
      $push: { history: historyEntry(RS.WITHDRAWN, "Withdrawn by buyer", buyerId, "buyer") },
    },
    "withdraw",
  );
  audit.log({
    action: "refund.withdrawn",
    actor: actor || SYSTEM_ACTOR,
    resource: { type: "order", id: refund.order },
    metadata: { refundId: String(refundId) },
  });
  return refund;
}

// ── Admin ────────────────────────────────────────────────────────────────────

/** Final decision on an escalated request. */
async function adminDecide(refundId, { decision, note, actor } = {}) {
  if (!["approve", "decline"].includes(decision)) {
    throw new RefundError('decision must be "approve" or "decline"');
  }
  await loadOwned(refundId, () => true);
  const by = actor?.userId ?? null;

  if (decision === "decline") {
    const refund = await transition(
      refundId,
      RS.ESCALATED,
      {
        $set: { status: RS.DECLINED, open: false, adminDecision: { decision: "declined", note, by, at: new Date() } },
        $push: { history: historyEntry(RS.DECLINED, note || "Declined by admin", by, "admin") },
      },
      "decline",
    );
    audit.log({
      action: "refund.admin_declined",
      actor: actor || SYSTEM_ACTOR,
      resource: { type: "order", id: refund.order },
      metadata: { refundId: String(refundId), note },
    });
    await notify.refundDeclined(refund);
    return refund;
  }

  const refund = await transition(
    refundId,
    RS.ESCALATED,
    {
      $set: {
        status: RS.APPROVED,
        approvedBy: "admin",
        adminDecision: { decision: "approved", note, by, at: new Date() },
      },
      $push: { history: historyEntry(RS.APPROVED, note || "Approved by admin", by, "admin") },
    },
    "approve",
  );
  audit.log({
    action: "refund.admin_approved",
    actor: actor || SYSTEM_ACTOR,
    resource: { type: "order", id: refund.order },
    metadata: { refundId: String(refundId), amount: refund.amount, note },
  });
  await notify.refundApproved(refund);
  return processRefund(refundId);
}

/**
 * Admin handling of a payout that could not complete on its own:
 *   needs_review + refunded      — the money did go out: record the provider's refund id and book it.
 *   needs_review + not_refunded  — no money moved: mark failed.
 *   failed       + retry         — the provider rejected it earlier; send it again.
 */
async function resolveRefund(refundId, { outcome, providerRefundId, note } = {}, actor) {
  const refund = await loadOwned(refundId, () => true);
  const by = actor?.userId ?? null;

  if (outcome === "retry") {
    await transition(
      refundId,
      RS.FAILED,
      {
        $set: { status: RS.APPROVED, lastError: null },
        $push: { history: historyEntry(RS.APPROVED, note || "Retried by admin", by, "admin") },
      },
      "retry",
    );
    return processRefund(refundId);
  }

  if (refund.status !== RS.NEEDS_REVIEW) {
    throw new RefundError(`Only needs_review refunds can be resolved this way (this one is ${refund.status})`, 409);
  }

  if (outcome === "refunded") {
    const refundRef = providerRefundId || refund.providerRefundId;
    if (!refundRef) {
      throw new RefundError("providerRefundId is required: the payment provider's id of the refund that was made");
    }
    await transition(
      refundId,
      RS.NEEDS_REVIEW,
      {
        $set: { status: RS.PROVIDER_SUCCEEDED, providerRefundId: String(refundRef), attempts: 0, lastError: null },
        $push: { history: historyEntry(RS.PROVIDER_SUCCEEDED, note || "Confirmed refunded by admin", by, "admin") },
      },
      "resolve",
    );
    return settleRefund(refundId);
  }

  if (outcome === "not_refunded") {
    if (refund.providerRefundId) {
      throw new RefundError("The payment provider already confirmed this refund; it cannot be marked not refunded", 409);
    }
    return transition(
      refundId,
      RS.NEEDS_REVIEW,
      {
        $set: { status: RS.FAILED },
        $push: { history: historyEntry(RS.FAILED, note || "Confirmed not refunded by admin", by, "admin") },
      },
      "resolve",
    );
  }

  throw new RefundError('outcome must be "refunded", "not_refunded" or "retry"');
}

// ── Payout ───────────────────────────────────────────────────────────────────

/**
 * Send an `approved` refund to the provider that took the charge, then settle
 * it. Safe to call concurrently and repeatedly — only the caller that wins the
 * approved → processing claim talks to the provider.
 */
async function processRefund(refundId) {
  let provider;
  try {
    const pending = await Refund.findById(refundId).select("provider");
    provider = payments.getProvider(pending?.provider ?? "flutterwave");
  } catch (err) {
    // Nothing was sent; leave it approved for the cron once config is fixed.
    await Refund.updateOne({ _id: refundId, status: RS.APPROVED }, { $set: { lastError: err.message } });
    return Refund.findById(refundId);
  }

  // A fresh reference per attempt: providers refuse to reuse one, and an
  // admin retry after a rejection is a new attempt.
  const refundReference = `RF-${refundId}-${Date.now().toString(36)}`;
  const claimed = await Refund.findOneAndUpdate(
    { _id: refundId, status: RS.APPROVED },
    {
      $set: { status: RS.PROCESSING, processingStartedAt: new Date(), providerRefundReference: refundReference },
      $push: { history: historyEntry(RS.PROCESSING, `Sending to ${provider.name}`) },
    },
    { new: true },
  );
  if (!claimed) return Refund.findById(refundId);

  let result;
  try {
    result = await provider.refund({
      providerTransactionId: claimed.providerTransactionId,
      amount: claimed.amount,
      refundReference,
      reason: REFUND_REASONS[claimed.reason] ?? "Refund",
    });
  } catch (err) {
    result = { outcome: "unknown", message: `${provider.name} call failed: ${err.message}` };
  }
  return applyProviderResult(claimed, provider, result);
}

/**
 * Persist what the provider said about a `processing` refund and move it on.
 * Shared by processRefund (the initiate call) and the cron (status queries).
 */
async function applyProviderResult(refund, provider, result) {
  const refundId = refund._id;

  if (result.outcome === "succeeded") {
    await Refund.updateOne(
      { _id: refundId, status: RS.PROCESSING },
      {
        $set: {
          status: RS.PROVIDER_SUCCEEDED,
          providerRefundId: result.providerRefundId,
          providerStatus: result.providerStatus,
          lastError: null,
        },
        $push: { history: historyEntry(RS.PROVIDER_SUCCEEDED, `${provider.name} refund ${result.providerRefundId}`) },
      },
    );
    audit.log({
      action: "refund.provider_succeeded",
      actor: SYSTEM_ACTOR,
      resource: { type: "order", id: refund.order },
      metadata: { refundId: String(refundId), provider: provider.name, providerRefundId: result.providerRefundId, amount: refund.amount },
    });
    return settleRefund(refundId);
  }

  if (result.outcome === "rejected") {
    await Refund.updateOne(
      { _id: refundId, status: RS.PROCESSING },
      {
        $set: { status: RS.FAILED, lastError: result.message, providerStatus: result.providerStatus ?? null },
        $push: { history: historyEntry(RS.FAILED, result.message) },
      },
    );
    audit.error({
      action: "refund.provider_rejected",
      actor: SYSTEM_ACTOR,
      resource: { type: "order", id: refund.order },
      metadata: { refundId: String(refundId), provider: provider.name, amount: refund.amount, error: result.message },
    });
    await notifyAdmins(
      `Refund rejected by ${provider.name}`,
      `An approved refund was rejected by ${provider.name}; no money moved. Retry it via POST /api/admin/refund-requests/{id}/resolve with outcome "retry".`,
      { refundId: String(refundId), orderId: String(refund.order), amount: refund.amount, error: result.message },
    ).catch(() => {});
    return Refund.findById(refundId);
  }

  // Pending or unknown. If the provider can be asked about our reference,
  // keep it processing and let the cron ask; otherwise a human must check.
  if (provider.supportsRefundStatus) {
    await Refund.updateOne(
      { _id: refundId, status: RS.PROCESSING },
      {
        $set: {
          providerStatus: result.providerStatus ?? null,
          ...(result.providerRefundId && { providerRefundId: result.providerRefundId }),
          lastError: result.outcome === "unknown" ? result.message : null,
        },
      },
    );
    return Refund.findById(refundId);
  }

  await markNeedsReview(refundId, RS.PROCESSING, result.message || `${provider.name} refund outcome unknown`);
  return Refund.findById(refundId);
}

async function markNeedsReview(refundId, fromStatus, message) {
  const refund = await Refund.findOneAndUpdate(
    { _id: refundId, status: fromStatus },
    {
      $set: { status: RS.NEEDS_REVIEW, lastError: message },
      $push: { history: historyEntry(RS.NEEDS_REVIEW, message) },
    },
    { new: true },
  );
  if (!refund) return;

  audit.error({
    action: "refund.needs_review",
    actor: SYSTEM_ACTOR,
    resource: { type: "order", id: refund.order },
    metadata: { refundId: String(refundId), amount: refund.amount, error: message },
  });
  await notifyAdmins(
    "Refund needs manual review",
    "A refund could not be confirmed automatically. Check the payment provider's dashboard, then resolve it via POST /api/admin/refund-requests/{id}/resolve.",
    { refundId: String(refundId), orderId: String(refund.order), amount: refund.amount, error: message },
  ).catch(() => {});
}

/**
 * Book a refund the provider has already made. Idempotent: the guarded
 * provider_succeeded → settled transition runs inside the same transaction as
 * the bookkeeping, so it commits exactly once.
 */
async function settleRefund(refundId) {
  let shortfalls = [];
  let settled = null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      shortfalls = [];
      settled = await Refund.findOneAndUpdate(
        { _id: refundId, status: RS.PROVIDER_SUCCEEDED },
        {
          $set: { status: RS.SETTLED, open: false, settledAt: new Date(), lastError: null },
          $push: { history: historyEntry(RS.SETTLED, "Refund booked") },
        },
        { new: true, session },
      );
      if (!settled) return;

      const order = await Order.findById(settled.order).session(session);
      if (!order) throw new Error(`Order ${settled.order} not found`);
      const paymentTx = await findPaymentTransaction(order._id, session);
      if (!paymentTx) throw new Error(`No payment transaction for order ${order._id}`);

      const ledger = storeRefundEntries({
        buyerId: settled.buyer,
        sellerId: settled.seller,
        amount: settled.amount,
        vendorAmount: settled.vendorAmount,
      });

      // Claw back what the seller's wallet can cover; the rest is owed by them.
      for (const { account, userId, amount: owed } of ledger.walletDebits) {
        const wallet = await Wallet.findOne({ user: userId }).session(session);
        const available =
          wallet && wallet.status === "active"
            ? money.max(0, money.subtract(wallet.balance, wallet.limits?.minimumBalance ?? 0))
            : 0;
        const recovered = money.min(owed, available);
        if (recovered > 0) await wallet.deductFunds(recovered, "refund", session);
        if (money.compare(recovered, owed) < 0) {
          shortfalls.push({ userId, account, owed, recovered, outstanding: money.subtract(owed, recovered) });
        }
      }

      const ledgerTx = await Transaction.createTransaction(
        {
          transactionId: `REF_${Date.now()}_${MakeID(16)}`,
          reference: `Refund-${settled._id}`,
          type: "order_refund",
          totalAmount: ledger.totalAmount,
          entries: withWalletShortfalls(ledger.entries, shortfalls),
          commission: {
            platformAmount: ledger.platformAmount,
            vendorAmount: settled.vendorAmount,
            dispatchAmount: 0,
          },
          relatedEntity: { type: "order", id: order._id },
          status: "completed",
          metadata: {
            paymentMethod: "refund",
            externalTransactionId: settled.providerRefundId,
            externalEventId: `FLW_REFUND_${settled.providerRefundId}`,
            notes: `Refund ${settled._id} (${settled.reason}), approved by ${settled.approvedBy}`,
            originalTransactionId: paymentTx.transactionId,
          },
        },
        session,
      );

      // Order payment status: fully refunded once every unit is refunded.
      const settledRefunds = await Refund.find({ order: order._id, status: RS.SETTLED })
        .select("items amount")
        .session(session)
        .lean();
      const refundedUnits = settledRefunds.reduce(
        (t, r) => t + r.items.reduce((u, i) => u + i.quantity, 0),
        0,
      );
      const totalUnits = order.products.reduce((t, l) => t + l.count, 0);
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            paymentStatus:
              refundedUnits >= totalUnits ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
            "paymentIntent.refunded_amount": money.sum(settledRefunds, (r) => r.amount),
            "paymentIntent.refunded_at": new Date(),
          },
        },
        { session },
      );

      await Refund.updateOne(
        { _id: refundId },
        { $set: { ledgerTransactionId: ledgerTx.transactionId, shortfalls } },
        { session },
      );

      await audit.logWithSession(
        {
          action: "payment.refunded",
          actor: SYSTEM_ACTOR,
          resource: { type: "order", id: order._id },
          changes: { after: { refundAmount: settled.amount } },
          metadata: {
            refundId: String(refundId),
            providerRefundId: settled.providerRefundId,
            transactionId: ledgerTx.transactionId,
            approvedBy: settled.approvedBy,
            shortfalls,
          },
        },
        session,
      );
    });
  } catch (err) {
    const refund = await Refund.findOneAndUpdate(
      { _id: refundId, status: RS.PROVIDER_SUCCEEDED },
      { $inc: { attempts: 1 }, $set: { lastError: err.message } },
      { new: true },
    );
    console.error(`[Refund] Booking of ${refundId} failed:`, err.message);
    if (refund && refund.attempts >= MAX_SETTLE_ATTEMPTS) {
      await markNeedsReview(
        refundId,
        RS.PROVIDER_SUCCEEDED,
        `The provider refunded the buyer but booking it failed ${refund.attempts} times: ${err.message}`,
      );
    }
    return Refund.findById(refundId);
  } finally {
    await session.endSession();
  }

  if (settled) {
    await notify.refundSettled(settled);
    if (shortfalls.length) {
      await notifyAdmins(
        "Refund exceeded seller wallet balance",
        "A buyer was refunded but the seller had already withdrawn part of their share. The uncovered amount is booked as owed by the seller (accounts_receivable).",
        { refundId: String(refundId), orderId: String(settled.order), shortfalls },
      ).catch(() => {});
    }
  }
  return Refund.findById(refundId);
}

/**
 * Cron: push every approved refund forward, follow up refunds the provider is
 * still working on, and dead-letter the ones stuck mid-call.
 */
async function recoverRefunds() {
  const stuckBefore = new Date(Date.now() - STUCK_PROCESSING_MS);
  const stuck = await Refund.find({ status: RS.PROCESSING, processingStartedAt: { $lt: stuckBefore } }).select(
    "_id order amount provider providerRefundReference processingStartedAt",
  );
  let followedUp = 0;
  for (const refund of stuck) {
    const provider = payments.isProvider(refund.provider) ? payments.getProvider(refund.provider) : null;
    if (!provider?.supportsRefundStatus || !refund.providerRefundReference) {
      await markNeedsReview(refund._id, RS.PROCESSING, "Stuck in processing: the process stopped mid-call to the payment provider");
      continue;
    }

    followedUp += 1;
    const result = await provider.getRefundStatus({ refundReference: refund.providerRefundReference });
    if (result.outcome === "succeeded" || result.outcome === "rejected") {
      await applyProviderResult(refund, provider, result);
    } else if (refund.processingStartedAt < new Date(Date.now() - PROVIDER_PENDING_MAX_MS)) {
      await markNeedsReview(
        refund._id,
        RS.PROCESSING,
        `${provider.name} has not finalised refund ${refund.providerRefundReference} after 24h (${result.providerStatus ?? result.message})`,
      );
    }
  }

  const approved = await Refund.find({ status: RS.APPROVED }).select("_id").limit(50);
  for (const { _id } of approved) await processRefund(_id);

  const unsettled = await Refund.find({ status: RS.PROVIDER_SUCCEEDED }).select("_id").limit(50);
  for (const { _id } of unsettled) await settleRefund(_id);

  return { stuck: stuck.length - followedUp, followedUp, approved: approved.length, unsettled: unsettled.length };
}

// ── Listing ──────────────────────────────────────────────────────────────────

/**
 * Paginated list for any viewer. `filter` is the caller's scope (buyer, store
 * or none for admin); `statuses` narrows it.
 */
async function listRefunds(filter, { statuses = [], page = 1, limit = 20 } = {}) {
  const valid = Object.values(RS);
  const unknown = statuses.filter((s) => !valid.includes(s));
  if (unknown.length) {
    throw new RefundError(`Invalid status: ${unknown.join(", ")}. Must be one of: ${valid.join(", ")}`);
  }
  const query = { ...filter, ...(statuses.length && { status: { $in: statuses } }) };
  const [rows, total] = await Promise.all([
    Refund.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("order", "orderNumber")
      .populate("store", "name")
      .populate("buyer", "fullName firstname lastname"),
    Refund.countDocuments(query),
  ]);
  return { rows, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
}

module.exports = {
  RefundError,
  REFUND_STATUS: RS,
  CLOSED_STATUSES,
  REFUND_REASONS,
  SELLER_RESPONSE_DAYS,
  REFUND_WINDOW_DAYS,
  canEscalate,
  getRefundableItems,
  createRefundRequest,
  sellerApprove,
  sellerReject,
  escalate,
  withdraw,
  adminDecide,
  resolveRefund,
  processRefund,
  settleRefund,
  recoverRefunds,
  listRefunds,
};
