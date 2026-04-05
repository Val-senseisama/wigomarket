/**
 * @file alertService.js
 * @description Active alerting system for administrators.
 *              Used for critical financial failures and fraud detection.
 */

const User = require("../models/userModel");
const sendEmail = require("../controllers/emailController");

const FROM = "WigoMarket Alerts <alerts@wigo1market.com>";

/**
 * Standardized HTML wrapper for admin alerts.
 */
function wrapAlert(title, body, metadata = {}) {
  const metaHtml = Object.entries(metadata)
    .map(
      ([key, val]) =>
        `<tr><td style="padding:8px;color:#666;border-bottom:1px solid #eee">${key}</td><td style="padding:8px;border-bottom:1px solid #eee"><strong>${JSON.stringify(val)}</strong></td></tr>`,
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;border:2px solid #ff4d4d;border-radius:8px">
      <div style="background:#ff4d4d;padding:20px;border-radius:6px 6px 0 0;text-align:center">
        <h2 style="color:#fff;margin:0">🚨 CRITICAL ALERT</h2>
      </div>
      <div style="padding:24px">
        <h3 style="color:#cc0000;margin-top:0">${title}</h3>
        <p style="font-size:16px;line-height:1.5">${body}</p>
        
        ${
          metaHtml
            ? `
          <h4 style="margin-top:24px;border-bottom:2px solid #eee;padding-bottom:8px">Contextual Metadata</h4>
          <table style="width:100%;border-collapse:collapse">
            ${metaHtml}
          </table>
        `
            : ""
        }

        <div style="margin-top:30px;padding:15px;background:#fff5f5;border-left:4px solid #ff4d4d;border-radius:4px">
          <strong>Action Required:</strong> Please log in to the admin dashboard immediately to investigate this event.
        </div>
      </div>
      <p style="font-size:12px;color:#999;text-align:center;padding:16px;background:#fafafa;margin:0;border-radius:0 0 6px 6px">
        This is an automated priority alert from WigoMarket Financial Hardening System.
      </p>
    </div>
  `;
}

/**
 * Send an alert to all registered admins.
 * Fire-and-forget safe.
 *
 * @param {string} title - Alert headline
 * @param {string} message - Detailed explanation
 * @param {Object} metadata - Extra JSON context
 */
async function notifyAdmins(title, message, metadata = {}) {
  try {
    // Find all users with admin role
    const admins = await User.find({ role: "admin" }, "email");
    if (!admins.length) {
      console.warn("[Alert] No admins found to notify.");
      return;
    }

    const recipientEmails = admins.map((a) => a.email);
    const html = wrapAlert(title, message, metadata);

    // Send email to all admins (Resend supports array of recipients)
    await sendEmail({
      to: recipientEmails[0], // Resend controller supports single 'to' currently, let's map or fix controller
      subject: `[ALERT] ${title}`,
      htm: html,
    });

    // If there are more admins, send individually or upgrade controller
    if (recipientEmails.length > 1) {
      for (let i = 1; i < recipientEmails.length; i++) {
        await sendEmail({
          to: recipientEmails[i],
          subject: `[ALERT] ${title}`,
          htm: html,
        }).catch((err) =>
          console.error(
            `[Alert] Failed to notify ${recipientEmails[i]}:`,
            err.message,
          ),
        );
      }
    }

    console.log(`[Alert] Notified ${admins.length} admins about: ${title}`);
  } catch (err) {
    console.error("[Alert] Failed to send admin notifications:", err.message);
  }
}

module.exports = { notifyAdmins };
