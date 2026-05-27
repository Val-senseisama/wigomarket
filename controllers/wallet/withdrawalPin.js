const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");

const PIN_REGEX = /^\d{4,6}$/;
const SALT_ROUNDS = 10;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

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

module.exports = { createWithdrawalPin, changeWithdrawalPin };
