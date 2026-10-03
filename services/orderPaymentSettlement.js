/**
 * @file orderPaymentSettlement.js
 * @description Books a verified card payment against its order — the one place
 * an order becomes Paid. Used by the client verify endpoint, the webhook
 * processor and the pending-payment cron, which used to carry three copies of
 * this with three different idempotency keys.
 *
 * Callers pass a charge the provider has already confirmed (status
 * "succeeded", from provider.verifyCharge). Nothing here calls the provider.
 *
 * EXACTLY ONCE: every path writes the same `metadata.externalEventId`
 * (`<provider>:charge:<providerTransactionId>`), which is unique on
 * Transaction, and the order is re-read inside the session, so a verify racing
 * a webhook books the payment once and the loser sees `already_paid`.
 */

const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Transaction = require("../models/transactionModel");
const VATConfig = require("../models/vatConfigModel");
const { calculateCommissionBreakdown } = require("./commissionService");
const { resolveVendorPayouts, creditVendorWallets, primaryVendor } = require("./vendorPayoutService");
const { orderPaymentEntries } = require("./orderPaymentLedger");
const { PaymentStatus, OrderStatus } = require("../utils/constants");
const { MakeID } = require("../Helpers/Helpers");
const money = require("../utils/money");
const audit = require("./auditService");
const { notifyAdmins } = require("./alertService");
const { publishStoreOrderEvent, EVENT } = require("./storeOrderEvents");

class SettlementError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "SettlementError";
    this.code = code; // "reference_mismatch" | "amount_mismatch" | "order_not_found"
  }
}

const chargeEventId = (provider, providerTransactionId) => `${provider}:charge:${providerTransactionId}`;

/** Every checkout reference this order has handed to a provider. */
function orderReferences(order) {
  const pi = order.paymentIntent ?? {};
  return new Set([pi.id, pi.reference, ...(pi.references ?? [])].filter(Boolean).map(String));
}

/** Find the order a provider reference belongs to. */
function findOrderByReference(reference) {
  return Order.findOne({
    $or: [{ "paymentIntent.references": reference }, { "paymentIntent.reference": reference }, { "paymentIntent.id": reference }],
  });
}

// How many of an order's most recent checkout attempts verification asks about.
const MAX_REFERENCES_CHECKED = 5;

/**
 * Ask the order's provider about its checkout attempts, newest first, and
 * return the first succeeded charge — or, if none succeeded, the newest
 * attempt's answer. Returns null for an order that never reached checkout.
 *
 * Verification is always by our own references, never by an id the client
 * sends, so a charge can only ever be claimed by the order that opened it.
 */
async function findOrderCharge(order) {
  const pi = order.paymentIntent ?? {};
  const providerName = pi.provider;
  if (!providerName) return null;
  const provider = require("./payments").getProvider(providerName);

  const references = (pi.references?.length ? [...pi.references] : [pi.reference ?? pi.id]).filter(Boolean).reverse();
  let newest = null;
  for (const reference of references.slice(0, MAX_REFERENCES_CHECKED)) {
    const charge = await provider.verifyCharge({ reference });
    if (charge.status === "succeeded") return { provider: providerName, charge };
    newest ??= charge;
  }
  return newest && { provider: providerName, charge: newest };
}

/**
 * @param {Object} args
 * @param {string} args.orderId
 * @param {string} args.provider       - adapter name that took the charge
 * @param {Object} args.charge         - provider.verifyCharge() result with status "succeeded"
 * @param {string} args.source         - "verify" | "webhook" | "cron" (ledger notes + audit)
 * @param {Object} args.actor          - audit actor
 * @returns {Promise<{ result: "settled"|"already_paid", order, transaction, commission?, vat? }>}
 */
async function settleOrderPayment({ orderId, provider, charge, source, actor }) {
  if (charge?.status !== "succeeded" || !charge.providerTransactionId) {
    throw new Error("settleOrderPayment needs a succeeded charge with a provider transaction id");
  }
  const eventId = chargeEventId(provider, charge.providerTransactionId);

  // Cheap pre-checks outside the session.
  const existing = await Transaction.findOne({ "metadata.externalEventId": eventId });
  if (existing) {
    return { result: "already_paid", order: await Order.findById(orderId), transaction: existing };
  }

  const vatConfig = await VATConfig.getActiveConfig();

  let outcome;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId)
        .populate("orderedBy", "fullName email mobile")
        .populate("products.product", "title listedPrice price store")
        .populate("deliveryAgent", "fullName email mobile")
        .session(session);
      if (!order) throw new SettlementError(`Order ${orderId} not found`, "order_not_found");

      // The charge must be for this order, not some other paid checkout.
      if (!orderReferences(order).has(String(charge.reference))) {
        throw new SettlementError(`Charge reference ${charge.reference} does not belong to order ${orderId}`, "reference_mismatch");
      }

      if (order.paymentStatus === PaymentStatus.PAID) {
        outcome = { result: "already_paid", order, transaction: null };
        return;
      }

      // Guard against paying a cheap checkout and claiming a dear order.
      if (!money.equals(charge.amount, order.paymentIntent.amount)) {
        throw new SettlementError(
          `Amount mismatch: expected ${order.paymentIntent.amount}, got ${charge.amount}`,
          "amount_mismatch",
        );
      }

      const commission = calculateCommissionBreakdown(order);
      const vatAmount = vatConfig ? vatConfig.calculateVAT(order.paymentIntent.amount) : 0;

      // One payout per store, each to that store's owner.
      const vendorPayouts = await resolveVendorPayouts(order, session);
      const vendor = await primaryVendor(vendorPayouts, session);
      const vatResponsibility =
        vatConfig && vendor ? vatConfig.getVATResponsibility(vendor, order.paymentIntent.amount) : "platform";

      // Balanced entries; VAT is a memo on `vat`, not ledger lines (see
      // services/orderPaymentLedger).
      const ledger = orderPaymentEntries({ order, payouts: vendorPayouts });

      const transaction = await Transaction.createTransaction(
        {
          transactionId: `PAY_${Date.now()}_${MakeID(16)}`,
          reference: `Payment-${order._id}`,
          type: "order_payment",
          totalAmount: ledger.totalAmount,
          entries: ledger.entries,
          vat: {
            rate: vatConfig?.rates?.standard ?? 7.5,
            amount: vatAmount,
            responsibility: vatResponsibility,
            collected: true,
          },
          commission: {
            platformRate: commission.platformRate,
            platformAmount: ledger.platformAmount,
            vendorAmount: commission.vendorAmount,
            // The delivery fee is held, not paid, at this point.
            dispatchAmount: 0,
          },
          relatedEntity: { type: "order", id: order._id },
          status: "completed",
          metadata: {
            paymentMethod: provider,
            externalTransactionId: charge.providerTransactionId,
            externalEventId: eventId,
            notes: `Payment confirmed by ${source} via ${provider}; VAT responsibility: ${vatResponsibility}`,
          },
        },
        session,
      );

      await creditVendorWallets(vendorPayouts, session);

      // No rider credit here: the delivery fee is held in accounts_payable and
      // paid to the rider on delivery (dispatchEarningsService).

      const updatedOrder = await Order.findByIdAndUpdate(
        order._id,
        {
          paymentStatus: PaymentStatus.PAID,
          "paymentIntent.status": "paid",
          "paymentIntent.provider": provider,
          "paymentIntent.providerTransactionId": charge.providerTransactionId,
          "paymentIntent.paid_at": new Date(),
          "paymentIntent.transaction_id": transaction.transactionId,
          orderStatus: OrderStatus.PENDING,
          processingLock: false,
        },
        { new: true, session },
      );

      outcome = {
        result: "settled",
        order: updatedOrder,
        transaction,
        commission,
        vat: { amount: vatAmount, responsibility: vatResponsibility, rate: vatConfig?.rates?.standard ?? 7.5 },
      };
    });
  } catch (err) {
    // Lost the race to another path booking this same charge.
    if (err.code === 11000 && /externalEventId/.test(err.message)) {
      return {
        result: "already_paid",
        order: await Order.findById(orderId),
        transaction: await Transaction.findOne({ "metadata.externalEventId": eventId }),
      };
    }
    if (err instanceof SettlementError && err.code !== "order_not_found") {
      audit.error({
        action: `payment.${err.code}`,
        actor,
        resource: { type: "order", id: orderId },
        metadata: { provider, source, reference: charge.reference, providerTransactionId: charge.providerTransactionId, amount: charge.amount, error: err.message },
      });
      await notifyAdmins(
        "Card payment could not be booked",
        `A ${provider} charge was confirmed but not booked against its order (${err.code}). The buyer may have been charged; check the order and the ${provider} dashboard.`,
        { orderId: String(orderId), provider, providerTransactionId: charge.providerTransactionId, amount: charge.amount, error: err.message },
      ).catch(() => {});
    }
    throw err;
  } finally {
    await session.endSession();
  }

  if (outcome.result === "already_paid") {
    // The order is paid by a different charge: the buyer paid twice.
    const paidBy = outcome.order.paymentIntent?.providerTransactionId;
    if (paidBy && String(paidBy) !== String(charge.providerTransactionId)) {
      audit.error({
        action: "payment.duplicate_charge",
        actor,
        resource: { type: "order", id: orderId },
        metadata: { provider, paidBy, duplicate: charge.providerTransactionId, amount: charge.amount },
      });
      await notifyAdmins(
        "Buyer charged twice for one order",
        `Order ${orderId} is already paid, but ${provider} confirmed a second charge for it. Refund the duplicate from the ${provider} dashboard.`,
        { orderId: String(orderId), provider, paidBy, duplicate: charge.providerTransactionId, amount: charge.amount },
      ).catch(() => {});
    }
    return outcome;
  }

  // Committed: a paid card order is new to sellers, so it arrives as
  // order.created on their dashboards (fire-and-forget).
  publishStoreOrderEvent(orderId, EVENT.CREATED);

  audit.log({
    action: "payment.verified",
    actor,
    resource: { type: "order", id: orderId },
    changes: { after: { paymentStatus: "Paid", transactionId: outcome.transaction.transactionId, amount: charge.amount, source } },
    metadata: { provider, externalTransactionId: charge.providerTransactionId },
  });

  return outcome;
}

module.exports = { settleOrderPayment, findOrderCharge, findOrderByReference, orderReferences, chargeEventId, SettlementError };
