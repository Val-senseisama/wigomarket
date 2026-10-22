const Token = require("../../models/tokensModel");
const sendEmail = require("../../controllers/emailController");
const crypto = require("crypto");
const { verificationCodeTemplate } = require("../../templates/Emails");

/**
 * Issue a fresh 6-digit code for a pending email change and email it to the
 * new address. Any earlier code for that address stops working, and the
 * 15-minute expiry restarts.
 *
 * @param {Object} user - needs firstname/fullName for the greeting
 * @param {string} newEmail - normalised (trimmed, lowercased) address
 */
async function issueEmailChangeCode(user, newEmail) {
  // Digits only, like the other OTPs the app asks for.
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  // One outstanding code per address. Replacing createdAt restarts the TTL.
  await Token.findOneAndUpdate(
    { email: newEmail },
    { email: newEmail, code, verified: false, sessionHash: null, createdAt: new Date() },
    { upsert: true },
  );
  sendEmail(
    {
      to: newEmail,
      text: "",
      subject: "Confirm your new email - WigoMarket",
      htm: verificationCodeTemplate(user.firstname || user.fullName || "User", code),
    },
    true,
  );
}

module.exports = { issueEmailChangeCode };
