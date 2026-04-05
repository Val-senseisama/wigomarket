const asyncHandler = require("express-async-handler");
const Wallet = require("../../models/walletModel");
const audit = require("../../services/auditService");

/**
 * @function updateBankAccount
 * @description Update bank account information for withdrawals
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {Object} req.body - Bank account details
 * @returns {Object} - Updated wallet information
 */
const updateBankAccount = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { accountName, accountNumber, bankCode, bankName } = req.body;
  
  // Validate required fields
  if (!accountName || !accountNumber || !bankCode || !bankName) {
    return res.status(400).json({
      success: false,
      message: "All bank account fields are required"
    });
  }
  
  try {
    const wallet = await Wallet.findOne({ user: _id });
    
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }
    
    // Update bank account information
    wallet.bankAccount = {
      accountName,
      accountNumber,
      bankCode,
      bankName,
      isVerified: false // Will be verified separately
    };
    
    await wallet.save();

    audit.log({
      action: "wallet.bank_account_updated",
      actor: audit.actor(req),
      resource: { type: "wallet", id: wallet._id },
      // Mask account number — only log last 4 digits
      changes: { after: { bankName, bankCode, accountName, accountNumber: `****${accountNumber.slice(-4)}` } },
    });

    res.json({
      success: true,
      message: "Bank account updated successfully",
      data: wallet,
    });
  } catch (error) {
    throw new Error(error.message);
  }

});

module.exports = updateBankAccount;
