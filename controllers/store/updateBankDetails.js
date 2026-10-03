const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const payments = require("../../services/payments");
const { storeAccountUpdateSuccessTemplate } = require("../../templates/Emails");
const sendEmail = require("../emailController");
const audit = require("../../services/auditService");

/**
 * @function updateBankDetails
 * @description Update store's bank details after checking the account exists
 *              with the payment provider.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - User ID
 * @param {Object} req.body - Bank details
 * @param {string} req.body.bankName - Bank name (required)
 * @param {string} req.body.accountNumber - Account number (required)
 * @param {string} req.body.accountName - Account name (required)
 * @param {string} req.body.bankCode - Bank code (required)
 * @returns {Object} - Updated store information with bank details
 * @throws {Error} - Throws error if validation fails, store not found, or bank details update fails
 */
const updateBankDetails = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { bankName, accountNumber, accountName, bankCode } = req.body;

  if(!Validate.string(bankName)){
    ThrowError("Invalid Bank Name");
  }

  if(!Validate.string(accountNumber)){
    ThrowError("Invalid Account Number");
  }

  if(!Validate.string(accountName)){
    ThrowError("Invalid Account Name");
  }

  if(!Validate.string(bankCode)){
    ThrowError("Invalid Bank Code");
  }

  try {
    const myStore = await Store.findOne({ owner: _id }, { _id: 1, name: 1, mobile: 1, email: 1 });

    if(!myStore){
      ThrowError("Store not found");
    }

    // Sellers are paid from their wallet by transfer, so the account only has
    // to exist; a typo here would send a payout nowhere.
    try {
      await payments.getProvider().resolveAccount({ accountNumber, bankCode });
    } catch (err) {
      ThrowError("Could not verify this bank account. Check the account number and bank.");
    }

      const updatedStore = await Store.findOneAndUpdate(
        { owner: _id },
        {
          $set: {
            bankDetails: {
              accountName: accountName,
              accountNumber: accountNumber,
              bankCode: bankCode,
              bankName: bankName,
            },
          },
        },
        { new: true }
      );
      const emailData = storeAccountUpdateSuccessTemplate(bankName, accountNumber, accountName);
      const data2 = {
        to: myStore.email ?? req.user?.email,
        text: `Hello ${req.user?.firstname}`,
        subject: "Store Account Update - WigoMarket",
        htm: emailData,
      };
     sendEmail(data2);
      audit.log({
        action: "store.bank_details_updated",
        actor: audit.actor(req),
        resource: { type: "store", id: updatedStore._id, displayName: myStore.name },
        changes: { after: { bankName, accountName, accountNumber: `****${accountNumber.slice(-4)}` } },
      });
    res.json(updatedStore);
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }

});

module.exports = updateBankDetails;
