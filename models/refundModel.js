const mongoose = require("mongoose");

/**
 * A buyer's request to a seller for a refund of that seller's items in an
 * order, and — once approved — the payout of that refund to the buyer's card.
 * See services/orderRefundService for every transition.
 *
 * Decision phase (who agrees to refund):
 *
 *   requested ──seller approves──────────────────────► approved
 *       │  └──seller rejects──► rejected                   ▲
 *       │                          │ buyer escalates       │ admin approves
 *       └──buyer escalates (seller ┴──────────────► escalated
 *          silent past respondBy)                          │ admin declines
 *                                                          ▼
 *   (buyer may withdraw any time before approval)       declined
 *
 * Payout phase (moving the money, from `approved`):
 *
 *   approved ──► processing ──► provider_succeeded ──► settled
 *                   │                  │
 *                   ├──► failed        └──► needs_review (booking kept failing)
 *                   └──► needs_review (Flutterwave outcome unknown)
 *
 *   failed        Flutterwave explicitly rejected the refund; no money moved.
 *                 An admin may retry it.
 *   needs_review  We cannot tell whether money moved. Never retried
 *                 automatically — Flutterwave refunds take no idempotency key,
 *                 so a blind retry could pay the buyer twice. An admin checks
 *                 the Flutterwave dashboard and resolves it.
 */
const REFUND_STATUS = {
  REQUESTED: "requested",
  REJECTED: "rejected",
  ESCALATED: "escalated",
  DECLINED: "declined",
  WITHDRAWN: "withdrawn",
  APPROVED: "approved",
  PROCESSING: "processing",
  PROVIDER_SUCCEEDED: "provider_succeeded",
  SETTLED: "settled",
  FAILED: "failed",
  NEEDS_REVIEW: "needs_review",
};

// Statuses that end a request. Anything else is "open" and blocks a second
// request for the same order + store.
const CLOSED_STATUSES = [REFUND_STATUS.DECLINED, REFUND_STATUS.WITHDRAWN, REFUND_STATUS.SETTLED];

const REFUND_REASONS = {
  damaged: "Item arrived damaged",
  wrong_item: "Wrong item received",
  missing_items: "Items missing from the order",
  not_as_described: "Not as described",
  not_delivered: "Order not delivered",
  order_cancelled: "Order was cancelled",
  other: "Other",
};

const decisionSchema = new mongoose.Schema(
  {
    decision: { type: String, enum: ["approved", "rejected", "declined"] },
    note: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: Date,
  },
  { _id: false },
);

const refundSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    // Whose wallet the vendor share comes back out of (the store's owner).
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Deterministic per request: `refund:{_id}`. Unique, so one request can
    // never produce two payouts.
    idempotencyKey: { type: String, required: true, unique: true },

    items: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        title: String,
        quantity: { type: Number, min: 1 },
        unitPrice: Number, // what the buyer paid per unit (listed price)
        vendorUnitPrice: Number, // what the seller was paid per unit
        _id: false,
      },
    ],
    // amount = vendorAmount + platformAmount. All naira, exact to 2dp.
    amount: { type: Number, required: true, min: 0.01 }, // refunded to the buyer
    vendorAmount: { type: Number, required: true }, // clawed back from the seller
    platformAmount: { type: Number, required: true }, // platform margin returned
    currency: { type: String, default: "NGN" },

    reason: { type: String, enum: Object.keys(REFUND_REASONS), required: true },
    details: { type: String, maxlength: 2000 },

    status: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.REQUESTED,
      index: true,
    },
    // true until the request reaches a closed status; backs the
    // one-open-request-per-order-and-store unique index.
    open: { type: Boolean, default: true },

    respondBy: { type: Date, required: true }, // seller deadline; after it the buyer may escalate
    sellerResponse: decisionSchema,
    escalation: { note: String, at: Date },
    adminDecision: decisionSchema,
    approvedBy: { type: String, enum: ["seller", "admin", null], default: null },

    // Flutterwave's id for the original charge, and for the refund once made.
    providerTransactionId: { type: String, required: true },
    providerRefundId: { type: String, default: null },
    providerStatus: { type: String, default: null },

    processingStartedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 }, // booking attempts after Flutterwave succeeded
    lastError: { type: String, default: null },

    settledAt: { type: Date, default: null },
    ledgerTransactionId: { type: String, default: null },
    // Seller wallets that could not cover their share (already withdrawn). The
    // uncovered part is booked as owed by the seller (accounts_receivable).
    shortfalls: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        account: String,
        owed: Number,
        recovered: Number,
        outstanding: Number,
        _id: false,
      },
    ],

    history: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        note: String,
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        role: String, // buyer | seller | admin | system
        _id: false,
      },
    ],
  },
  { timestamps: true },
);

refundSchema.index(
  { order: 1, store: 1 },
  { unique: true, partialFilterExpression: { open: true } },
);
refundSchema.index({ status: 1, updatedAt: 1 });
refundSchema.index({ store: 1, createdAt: -1 });

const Refund = mongoose.model("Refund", refundSchema);
Refund.REFUND_STATUS = REFUND_STATUS;
Refund.CLOSED_STATUSES = CLOSED_STATUSES;
Refund.REFUND_REASONS = REFUND_REASONS;

module.exports = Refund;
