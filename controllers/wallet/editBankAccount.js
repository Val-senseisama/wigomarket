const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");

// Fields the user is allowed to edit on an existing bank account.
// isDefault is managed via PUT /bank-account/:id/default; isVerified/verifiedAt
// are managed by the verification flow, not the client.
const EDITABLE_FIELDS = [
  "accountName",
  "accountNumber",
  "bankName",
  "bankCode",
  "phoneNumber",
];

/**
 * @function editBankAccount
 * @description Update the details of an existing bank account on the user's
 *              wallet. Only the provided fields are changed (partial update).
 *              This does not add an account, so the max-3 limit is unaffected;
 *              however, when the account number changes we still guard against
 *              colliding with any of the wallet's other (up to 3) accounts.
 *              Changing the account number, bank name or bank code resets the
 *              account's verified status, since the previously verified details
 *              no longer apply.
 * @param {Object} req - Express request object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.params.accountId - The _id of the bank account subdocument
 * @param {string} [req.body.accountName] - Bank account holder name
 * @param {string} [req.body.accountNumber] - Bank account number
 * @param {string} [req.body.bankName] - Bank name
 * @param {string} [req.body.bankCode] - Bank code (from the bank picker)
 * @param {string} [req.body.phoneNumber] - Phone number linked to the account
 * @returns {Object} - Updated wallet bank accounts
 */
const editBankAccount = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { accountId } = req.params;

  // Collect only the editable fields the caller actually sent.
  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      const value =
        typeof req.body[field] === "string"
          ? req.body[field].trim()
          : req.body[field];
      updates[field] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      success: false,
      message: `Provide at least one field to update (${EDITABLE_FIELDS.join(", ")}).`,
    });
  }

  // Reject explicit blanks on required fields.
  for (const field of ["accountName", "accountNumber", "bankName", "phoneNumber"]) {
    if (field in updates && !updates[field]) {
      return res.status(400).json({
        success: false,
        message: `${field} cannot be empty`,
      });
    }
  }

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

  // If the account number is changing, make sure it doesn't clash with one of
  // the wallet's other saved accounts.
  if (updates.accountNumber && updates.accountNumber !== targetAccount.accountNumber) {
    const duplicate = wallet.bankAccounts.find(
      (a) =>
        a._id.toString() !== accountId &&
        a.accountNumber === updates.accountNumber,
    );
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: "This bank account number is already linked to your wallet",
      });
    }
  }

  const before = {
    bankName: targetAccount.bankName,
    accountNumber: `****${targetAccount.accountNumber.slice(-4)}`,
  };

  // Changing where the money lands invalidates a prior verification.
  const identityChanged =
    (updates.accountNumber && updates.accountNumber !== targetAccount.accountNumber) ||
    (updates.bankName && updates.bankName !== targetAccount.bankName) ||
    (updates.bankCode && updates.bankCode !== targetAccount.bankCode);

  Object.assign(targetAccount, updates);

  if (identityChanged) {
    targetAccount.isVerified = false;
    targetAccount.verifiedAt = undefined;
  }

  await wallet.save();

  audit.log({
    action: "wallet.bank_account_updated",
    actor: audit.actor(req),
    resource: { type: "wallet", id: wallet._id },
    changes: {
      before,
      after: {
        bankName: targetAccount.bankName,
        accountNumber: `****${targetAccount.accountNumber.slice(-4)}`,
      },
    },
  });

  res.json({
    success: true,
    message: "Bank account updated successfully",
    data: {
      bankAccounts: wallet.bankAccounts,
    },
  });
});

module.exports = editBankAccount;
