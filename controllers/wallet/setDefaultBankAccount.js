const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");

/**
 * @function setDefaultBankAccount
 * @description Set a specific bank account as the default for withdrawals.
 *              All other accounts on the wallet will be unset as default.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.accountId - The _id of the bank account subdocument
 * @returns {Object} - Updated wallet bank accounts
 */
const setDefaultBankAccount = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { accountId } = req.params;

  const wallet = await Wallet.findOne({ user: _id });

  if (!wallet) {
    return res.status(404).json({
      success: false,
      message: "Wallet not found",
    });
  }

  const targetAccount = wallet.bankAccounts.id(accountId);
  if (!targetAccount) {
    return res.status(404).json({
      success: false,
      message: "Bank account not found",
    });
  }

  // Unset all, then set the target
  wallet.bankAccounts.forEach((account) => {
    account.isDefault = account._id.toString() === accountId;
  });

  await wallet.save();

  audit.log({
    action: "wallet.default_bank_account_changed",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
    changes: {
      after: {
        defaultAccountId: accountId,
        bankName: targetAccount.bankName,
        accountNumber: `****${targetAccount.accountNumber.slice(-4)}`,
      },
    },
  });

  res.json({
    success: true,
    message: "Default bank account updated successfully",
    data: {
      bankAccounts: wallet.bankAccounts,
    },
  });
});

module.exports = setDefaultBankAccount;
