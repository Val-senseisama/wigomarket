const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const redisClient = require("../../config/redisClient");

/**
 * @function updatePaymentInfo
 * @description STEP 3 of onboarding — add or replace the bank account used
 *              to receive delivery fee payouts.
 *
 *   The mobile bank picker returns bankCode alongside bankName, so agents never
 *   type it manually. accountName should be pre-filled from a name-inquiry API
 *   on the client before submitting.
 *
 * @body {string} accountNumber  - 10-digit NUBAN (required)
 * @body {string} accountName    - Account holder name as confirmed by bank (required)
 * @body {string} bankName       - Bank display name, e.g. "Guaranty Trust Bank" (required)
 * @body {string} [bankCode]     - 3-char Flutterwave bank code, e.g. "058" (recommended)
 */
const updatePaymentInfo = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { accountNumber, accountName, bankName, bankCode } = req.body;

  // ── Validation ────────────────────────────────────────────────────────────
  if (!accountNumber || typeof accountNumber !== "string") {
    return res.status(400).json({ success: false, message: "accountNumber is required" });
  }
  if (!/^\d{10}$/.test(accountNumber.trim())) {
    return res.status(400).json({ success: false, message: "accountNumber must be exactly 10 digits" });
  }
  if (!accountName || typeof accountName !== "string" || !accountName.trim()) {
    return res.status(400).json({ success: false, message: "accountName is required" });
  }
  if (!bankName || typeof bankName !== "string" || !bankName.trim()) {
    return res.status(400).json({ success: false, message: "bankName is required" });
  }
  if (bankCode !== undefined && !/^\d{3}$/.test(String(bankCode).trim())) {
    return res.status(400).json({ success: false, message: "bankCode must be a 3-digit string (e.g. \"058\")" });
  }

  // ── Update ────────────────────────────────────────────────────────────────
  const updated = await DispatchProfile.findOneAndUpdate(
    { user: _id },
    {
      "paymentInfo.accountNumber": accountNumber.trim(),
      "paymentInfo.accountName":   accountName.trim(),
      "paymentInfo.bankName":      bankName.trim(),
      ...(bankCode !== undefined && { "paymentInfo.bankCode": String(bankCode).trim() }),
    },
    { new: true, runValidators: false },
  );

  if (!updated) {
    return res.status(404).json({
      success: false,
      message: "Dispatch profile not found. Create your profile first.",
    });
  }

  // Invalidate profile cache
  try { await redisClient.del(`dispatch:profile:${_id}`); } catch (_) {}

  res.json({
    success: true,
    message: "Payment information saved.",
    data: {
      setupLevel: updated.setupLevel,
      setupSteps: updated.setupSteps,
      paymentInfo: {
        accountName:   updated.paymentInfo.accountName,
        accountNumber: updated.paymentInfo.accountNumber,
        bankName:      updated.paymentInfo.bankName,
        // bankCode intentionally omitted from response (internal field)
      },
    },
  });
});

module.exports = updatePaymentInfo;
