const Token = require("../../models/tokensModel");
const asyncHandler = require("express-async-handler");
const crypto = require("crypto");
const Validate = require("../../Helpers/Validate");

const FIFTEEN_MINUTES = 15 * 60 * 1000;

/**
 * @function verifyResetToken
 * @description Step 2 of 3 — verifies the 6-digit OTP from the user's email.
 *
 *   Security properties:
 *   - The hashed OTP is cleared immediately after first use (no replay).
 *   - A one-time `resetSession` nonce is generated with crypto.randomBytes (CSPRNG),
 *     only its SHA-256 hash is stored. The plaintext nonce is returned to the caller.
 *   - Step 3 (resetPassword) requires this nonce in the request body, binding the
 *     password update to the exact client that completed step 2.
 *
 * @param {string} req.body.email - The email the OTP was sent to
 * @param {string} req.body.code  - The 6-digit OTP from the email
 * @returns {{ resetSession: string }} - One-time session token for step 3
 */
const verifyResetToken = asyncHandler(async (req, res) => {
  const { email, code } = req.body;

  if (!Validate.email(email)) {
    return res.status(400).json({ success: false, message: "Invalid email" });
  }

  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      success: false,
      message: "code must be a 6-digit number",
    });
  }

  const hashedCode = crypto.createHash("sha256").update(code).digest("hex");

  const tokenRecord = await Token.findOne({ email, code: hashedCode });

  if (!tokenRecord) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired code. Please request a new one.",
    });
  }

  // Belt-and-suspenders expiry check (MongoDB TTL also removes it)
  if (Date.now() - new Date(tokenRecord.createdAt).getTime() > FIFTEEN_MINUTES) {
    await Token.deleteOne({ email });
    return res.status(400).json({
      success: false,
      message: "Code has expired. Please request a new one.",
    });
  }

  // Generate a proof-of-possession nonce — binds step 3 to this exact client.
  // Store only the hash; return the plaintext so only this client can use it.
  const resetSession = crypto.randomBytes(32).toString("hex");
  const sessionHash  = crypto.createHash("sha256").update(resetSession).digest("hex");

  await Token.findOneAndUpdate(
    { email },
    {
      verified: true,
      code: "",             // prevent OTP replay
      sessionHash,          // stored hash of the proof-of-possession nonce
    },
  );

  res.status(200).json({
    success: true,
    message: "Code verified. You may now reset your password.",
    resetSession,           // caller must send this back in step 3
  });
});

module.exports = verifyResetToken;
