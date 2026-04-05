/**
 * @file dispatchEmailService.js
 * @description Email notifications for every stage of the dispatch flow.
 *              All functions are fire-and-forget safe (errors are logged, not thrown).
 */

const sendEmail = require("../controllers/emailController");

const FROM = "WigoMarket <support@wigo1market.com>";

// ── Shared helpers ────────────────────────────────────────────────────────────

function wrap(body) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
      <div style="background:#4CAF50;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0">WigoMarket</h2>
      </div>
      <div style="padding:24px;border:1px solid #e0e0e0;border-top:none;border-radius:0 0 8px 8px">
        ${body}
      </div>
      <p style="font-size:12px;color:#999;text-align:center;margin-top:16px">
        This is an automated message from WigoMarket. Please do not reply.
      </p>
    </div>
  `;
}

function orderRef(order) {
  return order.paymentIntent?.id || order._id.toString();
}

// ── Stage 3: Agent assigned → notify customer ─────────────────────────────────

async function sendAgentAssignedEmail(customer, agent, order) {
  try {
    await sendEmail(
      {
        to: customer.email,
        subject: `Delivery agent assigned — Order #${orderRef(order)}`,
        htm: wrap(`
        <h3>Good news, ${customer.fullName || "there"}!</h3>
        <p>A delivery agent has been assigned to your order.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;color:#666">Order</td><td style="padding:8px"><strong>#${orderRef(order)}</strong></td></tr>
          <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Agent</td><td style="padding:8px"><strong>${agent.fullName || "Your delivery agent"}</strong></td></tr>
          <tr><td style="padding:8px;color:#666">Delivery address</td><td style="padding:8px">${order.deliveryAddress}</td></tr>
        </table>
        <p>Your agent will pick up your order shortly. We'll notify you when it's on the way.</p>
      `),
      },
      true,
    );
  } catch (err) {
    console.error("[Email] sendAgentAssignedEmail failed:", err.message);
  }
}

// ── Stage 4: Picked up → notify customer ─────────────────────────────────────

async function sendPickedUpEmail(customer, order) {
  try {
    await sendEmail(
      {
        to: customer.email,
        subject: `Your order has been picked up — Order #${orderRef(order)}`,
        htm: wrap(`
        <h3>Your order is on the move, ${customer.fullName || "there"}!</h3>
        <p>Your delivery agent has picked up Order <strong>#${orderRef(order)}</strong> from the store.</p>
        <p>They are on their way to you. You'll get another update when they're in transit.</p>
        <p style="color:#666;font-size:14px">Delivery address: ${order.deliveryAddress}</p>
      `),
      },
      true,
    );
  } catch (err) {
    console.error("[Email] sendPickedUpEmail failed:", err.message);
  }
}

// ── Stage 5: In transit → notify customer ────────────────────────────────────

async function sendInTransitEmail(customer, order) {
  try {
    await sendEmail(
      {
        to: customer.email,
        subject: `Your order is on the way — Order #${orderRef(order)}`,
        htm: wrap(`
        <h3>Almost there, ${customer.fullName || "there"}!</h3>
        <p>Your delivery agent is now in transit with Order <strong>#${orderRef(order)}</strong>.</p>
        <p>Please make sure someone is available to receive the package at:</p>
        <p style="padding:12px;background:#f5f5f5;border-radius:4px"><strong>${order.deliveryAddress}</strong></p>
      `),
      },
      true,
    );
  } catch (err) {
    console.error("[Email] sendInTransitEmail failed:", err.message);
  }
}

// ── Stage 6a: Agent confirmed → ask customer to confirm ──────────────────────

async function sendConfirmDeliveryRequestEmail(customer, order) {
  try {
    await sendEmail(
      {
        to: customer.email,
        subject: `Please confirm delivery — Order #${orderRef(order)}`,
        htm: wrap(`
        <h3>Did you receive your order?</h3>
        <p>Hi ${customer.fullName || "there"}, your delivery agent has marked Order <strong>#${orderRef(order)}</strong> as delivered.</p>
        <p>Please open the <strong>WigoMarket app</strong> and confirm that you received your package to complete the delivery.</p>
        <p style="color:#666;font-size:14px">If you did not receive your order, please contact our support team immediately.</p>
      `),
      },
      true,
    );
  } catch (err) {
    console.error(
      "[Email] sendConfirmDeliveryRequestEmail failed:",
      err.message,
    );
  }
}

// ── Stage 6b: Customer confirmed → notify agent ───────────────────────────────

async function sendEarningsCreditedEmail(agent, order, amount) {
  try {
    await sendEmail(
      {
        to: agent.email,
        subject: `Delivery confirmed — ₦${amount} credited to your wallet`,
        htm: wrap(`
        <h3>Payment received!</h3>
        <p>Hi ${agent.fullName || "there"}, the customer has confirmed delivery of Order <strong>#${orderRef(order)}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;color:#666">Order</td><td style="padding:8px"><strong>#${orderRef(order)}</strong></td></tr>
          <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Earnings credited</td><td style="padding:8px"><strong>₦${amount}</strong></td></tr>
        </table>
        <p>The amount has been added to your WigoMarket wallet. Great work!</p>
      `),
      },
      true,
    );
  } catch (err) {
    console.error("[Email] sendEarningsCreditedEmail failed:", err.message);
  }
}

module.exports = {
  sendAgentAssignedEmail,
  sendPickedUpEmail,
  sendInTransitEmail,
  sendConfirmDeliveryRequestEmail,
  sendEarningsCreditedEmail,
};
