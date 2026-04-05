/**
 * @file dispatchEarningsService.js
 * @description Credits a dispatch agent's wallet when they mark an order as delivered.
 *
 * SAFETY:
 *   - Idempotency: will not double-credit the same order (checks for existing
 *     dispatch_commission transaction for the order).
 *   - Atomicity: wallet balance + transaction ledger updated in one MongoDB session.
 *   - Validates the agent is actually assigned to the order before crediting.
 */

const mongoose = require("mongoose");
const Order = require("../models/orderModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const { MakeID } = require("../Helpers/Helpers");
const {
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
} = require("../utils/constants");
const {
  sendConfirmDeliveryRequestEmail,
  sendEarningsCreditedEmail,
} = require("./dispatchEmailService");
const audit = require("./auditService");

/**
 * Called when the dispatch agent taps "I delivered this order".
 * Sets agentConfirmed = true. If the customer has already confirmed,
 * credits earnings immediately. Otherwise emails the customer to confirm.
 *
 * @param {string} orderId     - The order being delivered
 * @param {string} agentUserId - The dispatch agent's User._id
 * @returns {Promise<{ credited: boolean, amount?: number, walletBalance?: number, reason?: string }>}
 */
async function agentConfirmDelivery(orderId, agentUserId, actorContext = {}) {
  // ── Idempotency check ────────────────────────────────────────────────────
  const alreadyCredited = await Transaction.findOne({
    reference: `DispatchEarnings-${orderId}`,
    type: "dispatch_commission",
    status: "completed",
  });

  if (alreadyCredited) {
    console.log(`[Dispatch] ⚡ Earnings already credited for order ${orderId}`);
    return { credited: false, reason: "already_credited" };
  }

  // ── Load order and validate ───────────────────────────────────────────────
  const order = await Order.findById(orderId)
    .populate("deliveryAgent", "fullName email")
    .populate("orderedBy", "fullName email");

  if (!order) throw new Error(`Order ${orderId} not found`);

  if (!order.deliveryAgent) {
    throw new Error(`Order ${orderId} has no assigned delivery agent`);
  }

  if (order.deliveryAgent._id.toString() !== agentUserId.toString()) {
    throw new Error("You are not the assigned delivery agent for this order");
  }

  if (order.paymentStatus !== PaymentStatus.PAID) {
    throw new Error("Order is not paid — earnings cannot be credited yet");
  }

  if (order.deliveryStatus === DeliveryStatus.DELIVERED) {
    throw new Error("Order has already been marked as delivered");
  }

  // ── Mark agent confirmed ──────────────────────────────────────────────────
  await Order.findByIdAndUpdate(orderId, {
    "deliveryConfirmation.agentConfirmed": true,
    "deliveryConfirmation.agentConfirmedAt": new Date(),
    "deliveryMetadata.confirmedByAgent": agentUserId,
  });

  audit.log({
    action: "delivery.agent_confirmed",
    actor: { userId: agentUserId, role: "dispatch", ...actorContext },
    resource: { type: "order", id: order._id },
    changes: { after: { agentConfirmed: true } },
  });

  // If customer already confirmed → credit now
  if (order.deliveryConfirmation?.customerConfirmed) {
    return _creditEarnings(order, agentUserId, actorContext);
  }

  // Otherwise email customer asking them to confirm
  sendConfirmDeliveryRequestEmail(order.orderedBy, order);

  return { credited: false, reason: "awaiting_customer_confirmation" };
}

/**
 * Called when the customer taps "I received my order".
 * Sets customerConfirmed = true. If the agent has already confirmed,
 * credits earnings immediately. Otherwise waits for agent.
 *
 * @param {string} orderId    - The order being confirmed
 * @param {string} customerId - The customer's User._id
 * @returns {Promise<{ credited: boolean, amount?: number, walletBalance?: number, reason?: string }>}
 */
async function customerConfirmDelivery(orderId, customerId, actorContext = {}) {
  const alreadyCredited = await Transaction.findOne({
    reference: `DispatchEarnings-${orderId}`,
    type: "dispatch_commission",
    status: "completed",
  });

  if (alreadyCredited) {
    return { credited: false, reason: "already_credited" };
  }

  const order = await Order.findById(orderId)
    .populate("deliveryAgent", "fullName email")
    .populate("orderedBy", "fullName email");

  if (!order) throw new Error(`Order ${orderId} not found`);

  if (order.orderedBy._id.toString() !== customerId.toString()) {
    throw new Error("This order does not belong to you");
  }

  if (order.deliveryStatus === DeliveryStatus.DELIVERED) {
    throw new Error("Order has already been marked as delivered");
  }

  // ── Mark customer confirmed ───────────────────────────────────────────────
  await Order.findByIdAndUpdate(orderId, {
    "deliveryConfirmation.customerConfirmed": true,
    "deliveryConfirmation.customerConfirmedAt": new Date(),
  });

  audit.log({
    action: "delivery.customer_confirmed",
    actor: { userId: customerId, role: "buyer", ...actorContext },
    resource: { type: "order", id: order._id },
    changes: { after: { customerConfirmed: true } },
  });

  // If agent already confirmed → credit now
  if (order.deliveryConfirmation?.agentConfirmed) {
    return _creditEarnings(order, order.deliveryAgent._id, actorContext);
  }

  return { credited: false, reason: "awaiting_agent_confirmation" };
}

/**
 * Internal: atomically credit the agent wallet and mark order delivered.
 * Called once both parties have confirmed.
 */
async function _creditEarnings(order, agentUserId, actorContext = {}) {
  const orderId = order._id.toString();
  const earningsAmount = order.deliveryFee || 0;

  if (earningsAmount <= 0) {
    await Order.findByIdAndUpdate(orderId, {
      deliveryStatus: DeliveryStatus.DELIVERED,
      orderStatus: OrderStatus.DELIVERED,
      "deliveryMetadata.deliveredAt": new Date(),
    });
    return { credited: false, reason: "zero_fee" };
  }

  const session = await mongoose.startSession();
  let finalBalance;

  try {
    await session.withTransaction(async () => {
      let wallet = await Wallet.findOne({ user: agentUserId }).session(session);
      if (!wallet) {
        wallet = await Wallet.createWallet(agentUserId, 0);
      }

      finalBalance = await wallet.creditEarning(earningsAmount, session);

      const txId = `DISPATCH_${Date.now()}_${MakeID(16)}`;
      await Transaction.createTransaction(
        {
          transactionId: txId,
          reference: `DispatchEarnings-${orderId}`,
          type: "dispatch_commission",
          totalAmount: earningsAmount,
          entries: [
            {
              account: "commission_payable",
              userId: agentUserId,
              debit: earningsAmount,
              credit: 0,
              description: `Dispatch fee earned for order ${orderId}`,
            },
            {
              account: "wallet_dispatch",
              userId: agentUserId,
              debit: 0,
              credit: earningsAmount,
              description: `Dispatch wallet credited — order ${orderId} delivered`,
            },
          ],
          commission: {
            platformRate: 0,
            platformAmount: 0,
            vendorAmount: 0,
            dispatchAmount: earningsAmount,
          },
          relatedEntity: { type: "order", id: order._id },
          status: "completed",
          metadata: {
            paymentMethod: "wallet_credit",
            notes: `Delivery confirmed by both parties for order ${orderId}`,
          },
        },
        session,
      );

      await Order.findByIdAndUpdate(
        orderId,
        {
          deliveryStatus: DeliveryStatus.DELIVERED,
          orderStatus: OrderStatus.DELIVERED,
          "deliveryMetadata.deliveredAt": new Date(),
          actualDeliveryTime: new Date(),
        },
        { session },
      );

      console.log(
        `[Dispatch] ✅ Credited ₦${earningsAmount} to agent ${agentUserId} for order ${orderId}`,
      );
    });
  } finally {
    await session.endSession();
  }

  audit.log({
    action: "delivery.completed",
    actor: { userId: agentUserId, role: "dispatch", ...actorContext },
    resource: { type: "order", id: order._id },
    changes: {
      after: {
        deliveryStatus: "delivered",
        orderStatus: "Delivered",
        earningsCredited: earningsAmount,
      },
    },
  });

  // Email agent — non-blocking
  sendEarningsCreditedEmail(order.deliveryAgent, order, earningsAmount);

  return {
    credited: true,
    amount: earningsAmount,
    walletBalance: finalBalance,
  };
}

// Keep legacy export name pointing to the agent-side confirm
const creditDispatchEarnings = agentConfirmDelivery;

module.exports = {
  creditDispatchEarnings,
  agentConfirmDelivery,
  customerConfirmDelivery,
};
