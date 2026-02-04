require("dotenv").config();
const sendEmail = require("./controllers/emailController");

// Test email data
const testEmailData = {
  to: "valizevbigiedavid@gmail.com", // Changed to verified email for Resend testing mode
  subject: "Test Email from WigoMarket",
  text: "This is a test email",
  htm: "<h1>Test Email</h1><p>This is a test email sent from WigoMarket using Resend API.</p><p>If you receive this, the email integration is working correctly!</p>",
};

// Send test email
async function testEmail() {
  try {
    console.log("Sending test email...");
    await sendEmail(testEmailData);
    console.log("✅ Test email sent successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Failed to send test email:", error);
    process.exit(1);
  }
}

testEmail();
