/**
 * @file refundNotificationService.js
 * @description In-app + push notifications for refund requests. Best-effort:
 *              a notification failure is logged and swallowed, never allowed
 *              to fail or roll back the refund step that triggered it.
 */

const Notification = require("../models/notificationModel");
const firebaseService = require("./firebaseNotificationService");
const { notifyAdmins } = require("./alertService");

const naira = (amount) => `₦${Number(amount).toLocaleString("en-NG")}`;

async function notifyUser(userId, role, type, title, message, refund) {
  if (!userId) return;
  const data = { refundId: String(refund._id), orderId: String(refund.order), type };
  try {
    await Notification.createNotification({
      recipient: userId,
      type,
      title,
      message,
      data,
      role,
      relatedEntity: { type: "order", id: refund.order },
    });
    await firebaseService.sendNotificationToUser(userId, title, message, data, "orderUpdates");
  } catch (err) {
    console.error(`[RefundNotify] ${type} to ${userId} failed:`, err.message);
  }
}

/** Seller: a buyer asked for a refund. */
const refundRequested = (refund) =>
  notifyUser(
    refund.seller,
    "seller",
    "refund_requested",
    "New refund request",
    `A buyer has requested a refund of ${naira(refund.amount)}. Please respond by ${refund.respondBy.toDateString()}.`,
    refund,
  );

/** Buyer: the refund was approved (by the seller or an admin). */
const refundApproved = (refund) =>
  notifyUser(
    refund.buyer,
    "buyer",
    "refund_approved",
    "Refund approved",
    `Your refund of ${naira(refund.amount)} has been approved and is on its way to your card.`,
    refund,
  );

/** Buyer: the seller rejected the request (they may escalate). */
const refundRejected = (refund) =>
  notifyUser(
    refund.buyer,
    "buyer",
    "refund_rejected",
    "Refund request rejected",
    `The seller rejected your refund request${refund.sellerResponse?.note ? `: ${refund.sellerResponse.note}` : ""}. You can ask WigoMarket to review it.`,
    refund,
  );

/** Buyer: an admin declined the escalated request (final). */
const refundDeclined = (refund) =>
  notifyUser(
    refund.buyer,
    "buyer",
    "refund_declined",
    "Refund request declined",
    `After review, your refund request was declined${refund.adminDecision?.note ? `: ${refund.adminDecision.note}` : ""}.`,
    refund,
  );

/** Buyer: the money has been sent back. */
const refundSettled = (refund) =>
  notifyUser(
    refund.buyer,
    "buyer",
    "order_refunded",
    "Refund sent",
    `${naira(refund.amount)} has been refunded to your card. It may take a few days to appear.`,
    refund,
  );

/** Seller + admins: the buyer escalated. */
async function refundEscalated(refund) {
  await notifyUser(
    refund.seller,
    "seller",
    "refund_escalated",
    "Refund request escalated",
    `A buyer has asked WigoMarket to review their ${naira(refund.amount)} refund request.`,
    refund,
  );
  try {
    await notifyAdmins(
      "Refund request escalated",
      "A buyer has escalated a refund request. Review it via GET /api/admin/refund-requests?status=escalated.",
      { refundId: String(refund._id), orderId: String(refund.order), amount: refund.amount },
    );
  } catch (err) {
    console.error("[RefundNotify] admin escalation alert failed:", err.message);
  }
}

module.exports = {
  refundRequested,
  refundApproved,
  refundRejected,
  refundDeclined,
  refundSettled,
  refundEscalated,
};
