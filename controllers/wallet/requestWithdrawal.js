const asyncHandler = require("express-async-handler");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const Wallet = require("../../models/walletModel");
const Transaction = require("../../models/transactionModel");
const { MakeID } = require("../../Helpers/Helpers");
const audit = require("../../services/auditService");

/**
 * @function requestWithdrawal
 * @description Request withdrawal from wallet to the default bank account.
 *              Requires a valid withdrawal PIN.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} req.body.amount - Withdrawal amount
 * @param {string} req.body.pin - Withdrawal PIN for authorisation
 * @returns {Object} - Withdrawal request result
 */
const requestWithdrawal = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { amount, pin } = req.body;

  // Validate amount
  if (!amount || amount <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid withdrawal amount is required",
    });
  }

  if (!pin) {
    return res.status(400).json({
      success: false,
      message: "Withdrawal PIN is required",
    });
  }

  // --- PIN verification (outside session — avoids session conflict on bcrypt) ---
  const walletForPin = await Wallet.findOne({ user: _id }).select(
    "+withdrawalPin.hash",
  );

  if (!walletForPin) {
    return res.status(404).json({ success: false, message: "Wallet not found" });
  }

  if (!walletForPin.withdrawalPin?.hash) {
    return res.status(400).json({
      success: false,
      message: "Withdrawal PIN not set. Please create a PIN first.",
    });
  }

  // Lockout check
  const lockoutExpiry = walletForPin.withdrawalPin.attempts?.lockedUntil;
  if (lockoutExpiry && lockoutExpiry > new Date()) {
    const minutesLeft = Math.ceil((lockoutExpiry - new Date()) / (1000 * 60));
    return res.status(429).json({
      success: false,
      message: `Too many failed PIN attempts. Try again in ${minutesLeft} minute(s).`,
    });
  }

  const pinValid = await bcrypt.compare(pin, walletForPin.withdrawalPin.hash);

  if (!pinValid) {
    walletForPin.withdrawalPin.attempts.count =
      (walletForPin.withdrawalPin.attempts.count || 0) + 1;

    if (walletForPin.withdrawalPin.attempts.count >= 5) {
      walletForPin.withdrawalPin.attempts.lockedUntil = new Date(
        Date.now() + 30 * 60 * 1000,
      );
      walletForPin.withdrawalPin.attempts.count = 0;
    }
    await walletForPin.save();

    audit.error({
      action: "wallet.withdrawal_pin_failed",
      actor: audit.actor(req),
      resource: { type: "wallet", id: walletForPin._id },
      metadata: { amount },
    });

    return res.status(401).json({
      success: false,
      message: "Incorrect withdrawal PIN",
    });
  }

  // Reset failed attempts on success
  walletForPin.withdrawalPin.attempts = { count: 0, lockedUntil: null };
  await walletForPin.save();

  // --- Transactional deduction ---
  const session = await mongoose.startSession();
  let transactionId, withdrawalFee, totalDeduction, remainingBalance, walletId;

  try {
    await session.withTransaction(async () => {
      const wallet = await Wallet.findOne({ user: _id }).session(session);

      if (!wallet) {
        audit.error({
          action: "wallet.withdrawal_failed",
          actor: audit.actor(req),
          metadata: { reason: "Wallet not found", amount },
        });
        throw new Error("Wallet not found");
      }
      if (wallet.status !== "active") {
        audit.error({
          action: "wallet.withdrawal_failed",
          actor: audit.actor(req),
          resource: { type: "wallet", id: wallet._id },
          metadata: { reason: "Wallet inactive", amount },
        });
        throw new Error("Wallet is not active");
      }

      const defaultBank = wallet.defaultBankAccount;
      if (!defaultBank) {
        audit.error({
          action: "wallet.withdrawal_failed",
          actor: audit.actor(req),
          resource: { type: "wallet", id: wallet._id },
          metadata: { reason: "No bank account configured", amount },
        });
        throw new Error("No bank account configured for withdrawal");
      }

      if (!wallet.canWithdraw) {
        audit.error({
          action: "wallet.withdrawal_failed",
          actor: audit.actor(req),
          resource: { type: "wallet", id: wallet._id },
          metadata: { reason: "Withdrawal limit exceeded", amount },
        });
        throw new Error("Withdrawal limit exceeded");
      }

      withdrawalFee = Math.max(amount * 0.01, 100);
      totalDeduction = amount + withdrawalFee;

      if (wallet.balance < totalDeduction) {
        audit.error({
          action: "wallet.withdrawal_failed",
          actor: audit.actor(req),
          resource: { type: "wallet", id: wallet._id },
          metadata: {
            reason: "Insufficient balance",
            amount,
            fee: withdrawalFee,
            balance: wallet.balance,
          },
        });
        throw new Error("Insufficient balance for withdrawal and fees");
      }

      walletId = wallet._id;

      // Deduct atomically — session-bound, rolls back if ledger write fails
      await wallet.deductFunds(totalDeduction, "withdrawal", session);
      remainingBalance = wallet.balance; // deductFunds updates this.balance

      transactionId = `WD_${Date.now()}_${MakeID(16)}`;
      await Transaction.createTransaction(
        {
          transactionId,
          reference: `Withdrawal-${transactionId}`,
          type: "wallet_withdrawal",
          totalAmount: amount,
          entries: [
            {
              account: "accounts_payable",
              userId: _id,
              debit: amount,
              credit: 0,
              description: `Withdrawal to ${defaultBank.bankName}`,
            },
            {
              account: "wallet_vendor",
              userId: _id,
              debit: 0,
              credit: amount,
              description: "Wallet withdrawal",
            },
            {
              account: "bank_transfer_fees",
              userId: _id,
              debit: withdrawalFee,
              credit: 0,
              description: "Withdrawal processing fee",
            },
            {
              account: "wallet_vendor",
              userId: _id,
              debit: 0,
              credit: withdrawalFee,
              description: "Fee deduction",
            },
          ],
          relatedEntity: { type: "withdrawal", id: wallet._id },
          status: "pending",
          metadata: {
            paymentMethod: "bank_transfer",
            bankReference: `****${defaultBank.accountNumber.slice(-4)}`,
            notes: `Withdrawal request for ${amount} NGN`,
          },
        },
        session,
      );
    });
  } catch (error) {
    throw new Error(error.message);
  } finally {
    await session.endSession();
  }

  // Audit and response OUTSIDE the session — avoids double-fire on transaction retry
  audit.log({
    action: "wallet.withdrawal_requested",
    actor: audit.actor(req),
    resource: { type: "wallet", id: walletId },
    changes: {
      after: { amount, fee: withdrawalFee, totalDeduction, remainingBalance },
    },
    metadata: { transactionId },
  });

  res.json({
    success: true,
    message: "Withdrawal request submitted successfully",
    data: {
      transactionId,
      amount,
      fee: withdrawalFee,
      totalDeduction,
      remainingBalance,
      estimatedProcessingTime: "1-3 business days",
    },
  });
});

module.exports = requestWithdrawal;
