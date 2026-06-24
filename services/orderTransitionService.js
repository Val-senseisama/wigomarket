const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Product = require("../models/productModel");
const { PaymentStatus } = require("../utils/constants");
const {
  STATUS,
  ROLE,
  normalizeStatus,
  isValidStatus,
  findTransition,
  allowedTransitions,
} = require("../utils/orderStatus");
const audit = require("./auditService");

/**
 * Error thrown when a status transition is rejected by the state machine.
 * Carries a `statusCode` so route handlers can return 400/409 instead of 500.
 */
class OrderTransitionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OrderTransitionError";
    this.statusCode = statusCode;
  }
}

// Restore product stock + reconcile payment status when cancelling.
const applyCancellationSideEffects = async (order, setFields, session) => {
  const productUpdates = (order.products || [])
    .filter((item) => item.product)
    .map((item) => ({
      updateOne: {
        // Guard sold >= count so a double-cancel can never push sold negative.
        filter: { _id: item.product._id || item.product, sold: { $gte: item.count } },
        update: { $inc: { quantity: item.count, sold: -item.count } },
      },
    }));

  if (productUpdates.length > 0) {
    await Product.bulkWrite(productUpdates, { session });
  }

  setFields.paymentStatus =
    order.paymentStatus === PaymentStatus.PAID
      ? PaymentStatus.REFUNDED
      : PaymentStatus.FAILED;
};

const runTransition = async ({ orderId, toStatus, role, actor, reason, req, extraSet }, session) => {
  const order = await Order.findById(orderId)
    .populate("products.product", "_id quantity sold")
    .session(session);

  if (!order) throw new OrderTransitionError("Order not found", 404);

  const from = normalizeStatus(order.orderStatus);

  if (from === toStatus) {
    throw new OrderTransitionError(`Order is already '${toStatus}'`, 409);
  }

  const transition = findTransition(from, toStatus, role, order.deliveryMethod);

  if (!transition) {
    // Audit the rejected attempt — useful for spotting bugs or abuse.
    audit.log({
      action: "order.status_transition_rejected",
      actor: actor || (req ? audit.actor(req) : undefined),
      resource: { type: "order", id: orderId },
      changes: { before: { orderStatus: from }, after: { orderStatus: toStatus } },
      metadata: {
        role,
        deliveryMethod: order.deliveryMethod,
        allowed: allowedTransitions(from, role, order.deliveryMethod),
        reason,
      },
    });
    throw new OrderTransitionError(
      `Illegal transition '${from}' → '${toStatus}' for role '${role}'. ` +
        `Allowed from '${from}': ${
          allowedTransitions(from, role, order.deliveryMethod).join(", ") || "none"
        }`,
      422,
    );
  }

  const setFields = { orderStatus: toStatus, ...(extraSet || {}) };
  if (toStatus === STATUS.CANCELLED) {
    await applyCancellationSideEffects(order, setFields, session);
  }

  const updated = await Order.findByIdAndUpdate(
    orderId,
    {
      $set: setFields,
      $push: { statusHistory: { status: toStatus, at: new Date(), role } },
    },
    { new: true, session },
  );

  audit.log({
    action: "order.status_updated",
    actor: actor || (req ? audit.actor(req) : undefined),
    resource: { type: "order", id: orderId },
    changes: { before: { orderStatus: from }, after: { orderStatus: toStatus } },
    metadata: { role, reason, deliveryMethod: order.deliveryMethod },
  });

  return updated;
};

/**
 * The single, validated entry point for every order lifecycle change.
 *
 * @param {Object}  opts
 * @param {string}  opts.orderId     Order to transition.
 * @param {string}  opts.toStatus    Target canonical status (utils/orderStatus STATUS).
 * @param {string}  opts.role        Actor role (utils/orderStatus ROLE).
 * @param {Object}  [opts.req]       Express req, for audit actor resolution.
 * @param {Object}  [opts.actor]     Pre-resolved audit actor (alternative to req).
 * @param {string}  [opts.reason]    Optional human reason, recorded in the audit log.
 * @param {Object}  [opts.extraSet]  Extra fields to $set alongside orderStatus.
 * @param {import("mongoose").ClientSession} [opts.session] Existing session to reuse.
 * @returns {Promise<Object>} The updated order document.
 * @throws {OrderTransitionError} On invalid status value or illegal/role-forbidden transition.
 */
const transitionOrder = async (opts) => {
  if (!opts.orderId) throw new OrderTransitionError("orderId is required");
  if (!isValidStatus(opts.toStatus)) {
    throw new OrderTransitionError(`Invalid status value: '${opts.toStatus}'`);
  }
  if (!opts.role) throw new OrderTransitionError("role is required");

  // Reuse the caller's session/transaction if provided; otherwise run our own
  // so cancellation stock-restore stays atomic with the status write.
  if (opts.session) {
    return runTransition(opts, opts.session);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await runTransition(opts, session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = { transitionOrder, OrderTransitionError, ROLE, STATUS };
