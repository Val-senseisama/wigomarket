const mongoose = require("mongoose");
const Transaction = require("../models/transactionModel");
const Wallet = require("../models/walletModel");
const audit = require("./auditService");
const { MakeID } = require("../Helpers/Helpers");

/**
 * Handle ledger updates for completed bill payments.
 * @param {Object} billRecord - The BillPayment model instance
 * @param {mongoose.ClientSession} session - Active MongoDB session
 */
async function completeBillTransaction(billRecord, session) {
  // Find the original pending transaction
  const originalTx = await Transaction.findOne({
    reference: billRecord.transactionRef,
    status: "pending",
  }).session(session);

  if (originalTx) {
    originalTx.status = "completed";
    originalTx.metadata.externalTransactionId =
      billRecord.vtpassResponse?.content?.transactions?.transaction_id;
    await originalTx.save({ session });
  }

  audit.log({
    action: "bill_payment.completed",
    resource: { type: "bill_payment", id: billRecord._id },
    metadata: { requestId: billRecord.requestId, amount: billRecord.amount },
  });
}

/**
 * Handle ledger updates and wallet refunds for failed bill payments.
 * @param {Object} billRecord - The BillPayment model instance
 * @param {mongoose.ClientSession} session - Active MongoDB session
 */
async function refundBillTransaction(billRecord, session) {
  // 1. Mark original transaction as cancelled/failed
  const originalTx = await Transaction.findOne({
    reference: billRecord.transactionRef,
  }).session(session);

  if (originalTx && originalTx.status === "pending") {
    originalTx.status = "failed";
    await originalTx.save({ session });
  }

  // 2. Create reversal ledger entry (system_adjustment or wallet_deposit)
  const txId = `REFUND_BILL_${Date.now()}_${MakeID(16)}`;
  await Transaction.createTransaction(
    {
      transactionId: txId,
      reference: `Refund-${billRecord.requestId}`,
      type: "system_adjustment",
      totalAmount: billRecord.amount,
      entries: [
        {
          account: "operating_expenses",
          userId: null,
          debit: billRecord.amount,
          credit: 0,
          description: `Refund for failed ${billRecord.serviceType} purchase: ${billRecord.requestId}`,
        },
        {
          account: "wallet_vendor",
          userId: billRecord.user,
          debit: 0,
          credit: billRecord.amount,
          description: `Refund credit to wallet`,
        },
      ],
      relatedEntity: { type: "payment", id: billRecord._id },
      status: "completed",
      metadata: {
        originalRequestId: billRecord.requestId,
        reason: "VTpass service failure",
      },
    },
    session,
  );

  // 3. Atomically credit the wallet
  const wallet = await Wallet.findOne({ user: billRecord.user }).session(
    session,
  );
  if (wallet) {
    await wallet.creditEarning(billRecord.amount, session, false);
  }

  audit.error({
    action: "bill_payment.refunded",
    resource: { type: "bill_payment", id: billRecord._id },
    metadata: { requestId: billRecord.requestId, amount: billRecord.amount },
  });
}

module.exports = {
  completeBillTransaction,
  refundBillTransaction,
};
