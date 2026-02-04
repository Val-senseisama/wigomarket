const { Resend } = require("resend");
const asyncHandler = require("express-async-handler");

const resend = new Resend(process.env.MAIL_API);

const sendEmail = asyncHandler(async (data2, req, res) => {
  try {
    const { data, error } = await resend.emails.send({
      from: "WigoMarket <support@wigo1market.com>",
      to: [data2.to],
      subject: data2.subject,
      html: data2.htm,
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
