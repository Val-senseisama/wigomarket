const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");

/**
 * @function deleteBankAccount
 * @description Remove a bank account from the user's wallet.
 *              The default account cannot be deleted while other accounts exist —
 *              set another account as default first. The last remaining account
 *              also cannot be deleted (wallet must always have one bank account
 *              if any have been added).
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.accountId - The _id of the bank account subdocument
 * @returns {Object} - Updated wallet bank accounts
 */
const deleteBankAccount = asyncHandler(async (req, res) => {
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

  // Prevent deleting the last account
  if (wallet.bankAccounts.length === 1) {
    return res.status(400).json({
      success: false,
      message:
        "Cannot remove your only bank account. Add another account first.",
    });
  }

  // Prevent deleting the default when others still exist
  if (targetAccount.isDefault) {
    return res.status(400).json({
      success: false,
      message:
        "Cannot remove the default bank account. Set another account as default first.",
    });
  }

  audit.log({
    action: "wallet.bank_account_removed",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
    changes: {
      before: {
        bankName: targetAccount.bankName,
        accountNumber: `****${targetAccount.accountNumber.slice(-4)}`,
      },
    },
  });

  targetAccount.deleteOne();
  await wallet.save();

  res.json({
    success: true,
    message: "Bank account removed successfully",
    data: {
      bankAccounts: wallet.bankAccounts,
    },
  });
});

module.exports = deleteBankAccount;
