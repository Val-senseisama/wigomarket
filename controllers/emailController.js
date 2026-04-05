const { Resend } = require("resend");
const asyncHandler = require("express-async-handler");

const resend = new Resend(process.env.MAIL_API);

/**
 * Send email via Resend.
 * @param {Object} data2 - Email details: { to, subject, htm, text }
 * @param {boolean} enqueue - If true, offloads to background BullMQ queue.
 */
const sendEmail = asyncHandler(async (data2, enqueue = false) => {
  if (enqueue) {
    const taskQueue = require("../services/taskQueue");
    if (taskQueue.isAvailable()) {
      await taskQueue.enqueue("email", data2);
      return { success: true, status: "queued" };
    }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: "WigoMarket <support@wigo1market.com>",
      to: [data2.to],
      subject: data2.subject,
      html: data2.htm,
      text: data2.text || data2.htm?.replace(/<[^>]*>?/gm, "") || "",
    });

    if (error) {
      console.error("Email sending error:", error);
      throw new Error(error.message);
    }

    console.log("Email sent successfully:", data);
    return data;
  } catch (error) {
    console.error("Failed to send email:", error);
    throw error;
  }
});

module.exports = sendEmail;
