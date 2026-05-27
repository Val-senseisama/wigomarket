const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");

/**
 * @function addBankAccount
 * @description Add a new bank account to the user's wallet (max 3 allowed).
 *              The first account is automatically set as default.
 *              Use PUT /bank-account/:id/default to change the default account.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.accountName - Bank account holder name
 * @param {string} req.body.accountNumber - Bank account number
 * @param {string} req.body.bankName - Bank name
 * @param {string} req.body.phoneNumber - Phone number linked to bank account
 * @param {string} [req.body.bankCode] - Bank code (provided by bank picker, used for Flutterwave payouts)
 * @returns {Object} - Updated wallet information
 */
const addBankAccount = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { accountName, accountNumber, bankName, phoneNumber, bankCode } = req.body;

  // Validate required fields
  if (!accountName || !accountNumber || !bankName || !phoneNumber) {
    return res.status(400).json({
      success: false,
      message:
        "Account name, account number, bank name, and phone number are required",
    });
  }

  const wallet = await Wallet.findOne({ user: _id });

  if (!wallet) {
    return res.status(404).json({
      success: false,
      message: "Wallet not found",
    });
  }

  // Enforce max 3 bank accounts
  if (wallet.bankAccounts.length >= 3) {
    return res.status(400).json({
      success: false,
      message:
        "Maximum of 3 bank accounts allowed. Please remove an existing account before adding a new one.",
    });
  }

  // Prevent duplicate account numbers
  const duplicate = wallet.bankAccounts.find(
    (a) => a.accountNumber === accountNumber,
  );
  if (duplicate) {
    return res.status(400).json({
      success: false,
      message: "This bank account number is already linked to your wallet",
    });
  }

  // First account is always the default; subsequent ones are non-default
  const isFirstAccount = wallet.bankAccounts.length === 0;

  wallet.bankAccounts.push({
    accountName,
    accountNumber,
    bankName,
    bankCode: bankCode || undefined,
    phoneNumber,
    isDefault: isFirstAccount,
  });

  await wallet.save();

  audit.log({
    action: "wallet.bank_account_added",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
    changes: {
      after: {
        bankName,
        accountName,
        accountNumber: `****${accountNumber.slice(-4)}`,
      },
    },
  });

  res.json({
    success: true,
    message: "Bank account added successfully",
    data: {
      bankAccounts: wallet.bankAccounts,
    },
  });
});

module.exports = addBankAccount;
