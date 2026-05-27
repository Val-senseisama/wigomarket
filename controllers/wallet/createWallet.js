const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");

/**
 * @function createWallet
 * @description Create a wallet for a user from the wallet section.
 *              Accepts bank account details that are set as the default account.
 *              During registration the payment service auto-creates wallets without
 *              bank details via Wallet.createWallet() directly.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {string} req.body.accountName - Bank account holder name
 * @param {string} req.body.accountNumber - Bank account number
 * @param {string} req.body.bankName - Bank name
 * @param {string} req.body.phoneNumber - Phone number linked to bank account
 * @param {string} [req.body.bankCode] - Bank code (provided by bank picker, used for Flutterwave payouts)
 * @returns {Object} - Created wallet information
 */
const createWallet = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { accountName, accountNumber, bankName, phoneNumber, bankCode } = req.body;

  // Validate required bank account fields
  if (!accountName || !accountNumber || !bankName || !phoneNumber) {
    return res.status(400).json({
      success: false,
      message:
        "Account name, account number, bank name, and phone number are required",
    });
  }

  // Check if user already has a wallet
  const existingWallet = await Wallet.findOne({ user: _id });
  if (existingWallet) {
    return res.status(400).json({
      success: false,
      message: "User already has a wallet",
    });
  }

  // Create wallet with the first bank account as default
  const wallet = await Wallet.create({
    user: _id,
    balance: 0,
    bankAccounts: [
      {
        accountName,
        accountNumber,
        bankName,
        bankCode: bankCode || undefined,
        phoneNumber,
        isDefault: true,
      },
    ],
  });

  res.status(201).json({
    success: true,
    message: "Wallet created successfully",
    data: wallet,
  });
});

module.exports = createWallet;
