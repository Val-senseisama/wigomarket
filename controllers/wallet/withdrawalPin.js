const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const Wallet = require("../../models/walletModel");
const User = require("../../models/userModel");
const sendEmail = require("../emailController");
const { withdrawalPinResetTemplate } = require("../../templates/Emails");
const audit = require("../../services/auditService");

const PIN_REGEX = /^\d{4,6}$/;
const SALT_ROUNDS = 10;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

// Forgot/reset PIN flow
const RESET_OTP_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_RESET_OTP_ATTEMPTS = 5;

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

/**
 * @function createWithdrawalPin
 * @description Create a withdrawal PIN for the user's wallet.
 *              PIN must be 4–6 digits. Can only be called once — use
 *              PUT /api/wallet/pin to change an existing PIN.
 * @param {Object} req - Express request object
 * @param {string} req.body.pin - 4–6 digit numeric PIN
 */
const createWithdrawalPin = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { pin } = req.body;

  if (!pin || !PIN_REGEX.test(pin)) {
    return res.status(400).json({
      success: false,
      message: "PIN must be a 4 to 6 digit number",
    });
  }

  // Fetch wallet with the hidden pin hash field
  const wallet = await Wallet.findOne({ user: _id }).select(
    "+withdrawalPin.hash",
  );

  if (!wallet) {
    return res.status(404).json({
      success: false,
      message: "Wallet not found",
    });
  }

  if (wallet.withdrawalPin?.hash) {
    return res.status(400).json({
      success: false,
      message:
        "A withdrawal PIN already exists. Use PUT /api/wallet/pin to change it.",
    });
  }

  const hash = await bcrypt.hash(pin, SALT_ROUNDS);

  wallet.withdrawalPin = {
    hash,
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: { count: 0, lockedUntil: null },
  };

  await wallet.save();

  audit.log({
    action: "wallet.pin_created",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
  });

  res.status(201).json({
    success: true,
    message: "Withdrawal PIN created successfully",
  });
});

/**
 * @function changeWithdrawalPin
 * @description Change an existing withdrawal PIN.
 * @param {Object} req - Express request object
 * @param {string} req.body.currentPin - The current 4–6 digit PIN
 * @param {string} req.body.newPin - The new 4–6 digit PIN
 */
const changeWithdrawalPin = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { currentPin, newPin } = req.body;

  if (!currentPin || !newPin) {
    return res.status(400).json({
      success: false,
      message: "Current PIN and new PIN are required",
    });
  }

  if (!PIN_REGEX.test(newPin)) {
    return res.status(400).json({
      success: false,
      message: "New PIN must be a 4 to 6 digit number",
    });
  }

  if (currentPin === newPin) {
    return res.status(400).json({
      success: false,
      message: "New PIN must be different from the current PIN",
    });
  }

  const wallet = await Wallet.findOne({ user: _id }).select(
    "+withdrawalPin.hash",
  );

  if (!wallet) {
    return res.status(404).json({
      success: false,
      message: "Wallet not found",
    });
  }

  if (!wallet.withdrawalPin?.hash) {
    return res.status(400).json({
      success: false,
      message:
        "No withdrawal PIN set. Use POST /api/wallet/pin to create one first.",
    });
  }

  // Check lockout
  const lockoutExpiry = wallet.withdrawalPin.attempts?.lockedUntil;
  if (lockoutExpiry && lockoutExpiry > new Date()) {
    const minutesLeft = Math.ceil(
      (lockoutExpiry - new Date()) / (1000 * 60),
    );
    return res.status(429).json({
      success: false,
      message: `Too many failed attempts. Try again in ${minutesLeft} minute(s).`,
    });
  }

  const isMatch = await bcrypt.compare(currentPin, wallet.withdrawalPin.hash);

  if (!isMatch) {
    // Increment failed attempts
    wallet.withdrawalPin.attempts.count =
      (wallet.withdrawalPin.attempts.count || 0) + 1;

    if (wallet.withdrawalPin.attempts.count >= MAX_PIN_ATTEMPTS) {
      wallet.withdrawalPin.attempts.lockedUntil = new Date(
        Date.now() + LOCKOUT_MINUTES * 60 * 1000,
      );
      wallet.withdrawalPin.attempts.count = 0;
    }

    await wallet.save();

    audit.error({
      action: "wallet.pin_change_failed",
      actor: audit.actor(req),
      resource: { type: "wallet", id: wallet._id },
      metadata: { reason: "Incorrect current PIN" },
    });

    return res.status(401).json({
      success: false,
      message: "Current PIN is incorrect",
    });
  }

  // Update PIN
  const hash = await bcrypt.hash(newPin, SALT_ROUNDS);
  wallet.withdrawalPin.hash = hash;
  wallet.withdrawalPin.updatedAt = new Date();
  wallet.withdrawalPin.attempts = { count: 0, lockedUntil: null };

  await wallet.save();

  audit.log({
    action: "wallet.pin_changed",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
  });

  res.json({
    success: true,
    message: "Withdrawal PIN changed successfully",
  });
});

/**
 * @function forgotWithdrawalPin
 * @description Step 1 of 3 — starts the withdrawal PIN reset flow for a user who
 *              has forgotten their PIN. Generates a 6-digit OTP, stores a hashed
 *              copy on the wallet (15-min validity) and emails the plaintext code
 *              to the user's registered email. The OTP is never returned in the
 *              response.
 * @param {Object} req - Express request object (authenticated)
 */
const forgotWithdrawalPin = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  const wallet = await Wallet.findOne({ user: _id }).select(
    "+withdrawalPin.hash",
  );

  if (!wallet) {
    return res.status(404).json({
      success: false,
      message: "Wallet not found",
    });
  }

  if (!wallet.withdrawalPin?.hash) {
    return res.status(400).json({
      success: false,
      message:
        "No withdrawal PIN set. Use POST /api/wallet/pin to create one.",
    });
  }

  // 6-digit numeric OTP from the OS CSPRNG (uniform, unpredictable)
  const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

  wallet.withdrawalPin.reset = {
    otpHash: sha256(otp),
    sessionHash: null,
    requestedAt: new Date(),
    attempts: 0,
  };

  await wallet.save();

  // Look up the email/name to send the code to — only the registered email is used
  const user = await User.findById(_id, { email: 1, fullName: 1 });

  if (user?.email) {
    sendEmail(
      {
        to: user.email,
        text: `Your WigoMarket withdrawal PIN reset code is: ${otp}. It expires in 15 minutes.`,
        subject: "Withdrawal PIN Reset Code - WigoMarket",
        htm: withdrawalPinResetTemplate(user.fullName || "User", otp),
      },
      true,
    );
  }

  audit.log({
    action: "wallet.pin_reset_requested",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
  });

  // NOTE: never include the OTP in the response — not even in development
  res.status(200).json({
    success: true,
    message: "A withdrawal PIN reset code has been sent to your email.",
    expiresIn: "15 minutes",
  });
});

/**
 * @function verifyWithdrawalPinReset
 * @description Step 2 of 3 — verifies the 6-digit OTP emailed in step 1 and, on
 *              success, returns a one-time `resetSession` nonce required by step 3.
 *              The OTP is consumed (cannot be replayed) and only the hash of the
 *              nonce is stored, so only this client can complete the reset.
 * @param {Object} req - Express request object (authenticated)
 * @param {string} req.body.code - The 6-digit OTP from the email
 */
const verifyWithdrawalPinReset = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { code } = req.body;

  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({
      success: false,
      message: "code must be a 6-digit number",
    });
  }

  const wallet = await Wallet.findOne({ user: _id }).select(
    "+withdrawalPin.reset.otpHash +withdrawalPin.reset.sessionHash",
  );

  if (!wallet) {
    return res.status(404).json({ success: false, message: "Wallet not found" });
  }

  const reset = wallet.withdrawalPin?.reset;

  if (!reset?.otpHash || !reset.requestedAt) {
    return res.status(400).json({
      success: false,
      message: "No active reset request. Start again via POST /api/wallet/pin/forgot.",
    });
  }

  // Expiry check
  if (Date.now() - new Date(reset.requestedAt).getTime() > RESET_OTP_TTL_MS) {
    wallet.withdrawalPin.reset = undefined;
    await wallet.save();
    return res.status(400).json({
      success: false,
      message: "Reset code has expired. Please request a new one.",
    });
  }

  const isMatch = reset.otpHash === sha256(code);

  if (!isMatch) {
    reset.attempts = (reset.attempts || 0) + 1;

    // Too many wrong attempts — invalidate the OTP so the user must request a new one
    if (reset.attempts >= MAX_RESET_OTP_ATTEMPTS) {
      wallet.withdrawalPin.reset = undefined;
      await wallet.save();

      audit.error({
        action: "wallet.pin_reset_verify_failed",
        actor: audit.actor(req),
        resource: { type: "wallet", id: wallet._id },
        metadata: { reason: "Too many invalid attempts — reset invalidated" },
      });

      return res.status(429).json({
        success: false,
        message:
          "Too many incorrect codes. Please request a new reset code.",
      });
    }

    await wallet.save();

    audit.error({
      action: "wallet.pin_reset_verify_failed",
      actor: audit.actor(req),
      resource: { type: "wallet", id: wallet._id },
      metadata: { reason: "Incorrect reset code" },
    });

    return res.status(400).json({
      success: false,
      message: "Invalid reset code.",
    });
  }

  // Issue a one-time proof-of-possession nonce; store only its hash, consume the OTP
  const resetSession = crypto.randomBytes(32).toString("hex");
  wallet.withdrawalPin.reset.sessionHash = sha256(resetSession);
  wallet.withdrawalPin.reset.otpHash = null; // prevent OTP replay
  wallet.withdrawalPin.reset.attempts = 0;
  await wallet.save();

  res.status(200).json({
    success: true,
    message: "Code verified. You may now set a new withdrawal PIN.",
    resetSession,
  });
});

/**
 * @function resetWithdrawalPin
 * @description Step 3 of 3 — sets a new withdrawal PIN. Requires the `resetSession`
 *              nonce returned by step 2 as proof the caller verified the OTP. The
 *              reset state is consumed once the new PIN is written, and any active
 *              lockout is cleared.
 * @param {Object} req - Express request object (authenticated)
 * @param {string} req.body.newPin - The new 4–6 digit PIN
 * @param {string} req.body.resetSession - The nonce returned by step 2
 */
const resetWithdrawalPin = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { newPin, resetSession } = req.body;

  if (!newPin || !PIN_REGEX.test(newPin)) {
    return res.status(400).json({
      success: false,
      message: "New PIN must be a 4 to 6 digit number",
    });
  }

  if (!resetSession || typeof resetSession !== "string") {
    return res.status(400).json({
      success: false,
      message:
        "resetSession is required. Complete step 2 first (POST /api/wallet/pin/verify-reset).",
    });
  }

  const wallet = await Wallet.findOne({ user: _id }).select(
    "+withdrawalPin.hash +withdrawalPin.reset.sessionHash",
  );

  if (!wallet) {
    return res.status(404).json({ success: false, message: "Wallet not found" });
  }

  const reset = wallet.withdrawalPin?.reset;

  if (!reset?.sessionHash || reset.sessionHash !== sha256(resetSession)) {
    return res.status(400).json({
      success: false,
      message: "Invalid or expired reset session. Please start the reset again.",
    });
  }

  if (
    !reset.requestedAt ||
    Date.now() - new Date(reset.requestedAt).getTime() > RESET_OTP_TTL_MS
  ) {
    wallet.withdrawalPin.reset = undefined;
    await wallet.save();
    return res.status(400).json({
      success: false,
      message: "Reset session has expired. Please start the reset again.",
    });
  }

  // Set the new PIN, consume the reset state, and clear any lockout
  wallet.withdrawalPin.hash = await bcrypt.hash(newPin, SALT_ROUNDS);
  wallet.withdrawalPin.updatedAt = new Date();
  wallet.withdrawalPin.attempts = { count: 0, lockedUntil: null };
  wallet.withdrawalPin.reset = undefined;

  await wallet.save();

  audit.log({
    action: "wallet.pin_reset_success",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
  });

  res.status(200).json({
    success: true,
    message: "Withdrawal PIN reset successfully.",
  });
});

module.exports = {
  createWithdrawalPin,
  changeWithdrawalPin,
  forgotWithdrawalPin,
  verifyWithdrawalPinReset,
  resetWithdrawalPin,
};
