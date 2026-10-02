/**
 * @file orderPaymentLedger.js
 * @description Double-entry lines for settling an order payment, and for
 *              refunding one. Shared by every settlement path (webhook,
 *              /payment/verify, pending-payment cron) and by seller-approved
 *              refunds.
 *
 * Payment (customer paid A):
 *   Dr cash_account          A
 *   Cr wallet_vendor         each seller's share (one line per seller)
 *   Cr accounts_payable      the delivery fee, held until the rider completes
 *                            the delivery — dispatchEarningsService pays the
 *                            rider then (Dr accounts_payable, Cr
 *                            wallet_dispatch). It is never paid out here,
 *                            or a rider assigned before payment would be paid
 *                            twice.
 *   Cr commission_revenue    the rest: the platform margin, plus any rounding
 *
 * The platform line is the balancing figure, so debits always equal credits.
 * If the customer paid *less* than the sellers and rider are owed (e.g. a stale
 * cart price), the platform covers the shortfall as a debit to
 * commission_revenue rather than short-paying anyone.
 *
 * VAT is deliberately NOT posted here. Whether VAT is added to the price or
 * included in it is undecided, and customers are not currently charged VAT, so
 * there is no VAT money to book. The computed figure is still recorded on the
 * transaction's `vat` field as a memo.
 *
 * Refund (one seller's items): the buyer's cash is credited back, the seller's
 * wallet gives back their share and the platform returns its margin — see
 * storeRefundEntries.
 *
 * `totalAmount` is the sum of debits, which Transaction's pre-save validates.
 * All arithmetic goes through utils/money.
 */

const money = require("../utils/money");

const idOf = (ref) => (ref && ref._id ? ref._id : ref) ?? null;

const PLATFORM = "commission_revenue";

/** Close a set of lines with the platform's balancing line. */
function balanceWithPlatform(lines, description) {
  const debits = money.sum(lines, (l) => l.debit);
  const credits = money.sum(lines, (l) => l.credit);
  const gap = money.subtract(debits, credits); // > 0: platform credit; < 0: platform debit

  if (gap > 0) {
    lines.push({ account: PLATFORM, userId: null, debit: 0, credit: gap, description });
  } else if (gap < 0) {
    lines.push({
      account: PLATFORM,
      userId: null,
      debit: money.subtract(0, gap),
      credit: 0,
      description: `${description} (platform covers shortfall)`,
    });
  }

  return {
    entries: lines,
    totalAmount: money.sum(lines, (l) => l.debit),
    platformAmount: gap,
  };
}

/**
 * @param {Object} opts
 * @param {Object} opts.order       Order with paymentIntent.amount, orderedBy
 *                                  and deliveryFee.
 * @param {Object[]} opts.payouts   From vendorPayoutService.resolveVendorPayouts.
 * @returns {{ entries: Object[], totalAmount: number, platformAmount: number,
 *             heldDeliveryFee: number }}
 */
function orderPaymentEntries({ order, payouts }) {
  const amount = money.round(order.paymentIntent.amount);
  const deliveryFee = money.round(order.deliveryFee || 0);

  const lines = [
    {
      account: "cash_account",
      userId: idOf(order.orderedBy),
      debit: amount,
      credit: 0,
      description: `Payment for order ${order._id}`,
    },
    ...payouts.map(({ storeId, userId, amount: share }) => ({
      account: "wallet_vendor",
      userId,
      debit: 0,
      credit: share,
      description: `Vendor earnings (store ${storeId})`,
    })),
  ];

  if (deliveryFee > 0) {
    lines.push({
      account: "accounts_payable",
      userId: null,
      debit: 0,
      credit: deliveryFee,
      description: "Delivery fee held until delivery is completed",
    });
  }

  return {
    ...balanceWithPlatform(lines, "Platform commission"),
    heldDeliveryFee: deliveryFee,
  };
}

/**
 * Refund one seller's items to the buyer.
 *
 *   Cr cash_account          amount         (back to the buyer's card)
 *   Dr wallet_vendor         vendorAmount   (out of the seller's wallet)
 *   Dr commission_revenue    the rest       (the platform returns its margin)
 *
 * The platform line is the balancing figure. If the seller's share exceeds
 * what the buyer paid (a negative margin), it becomes a credit.
 *
 * @param {Object} opts
 * @param {Object} opts.buyerId
 * @param {Object} opts.sellerId
 * @param {number} opts.amount        Naira refunded to the buyer.
 * @param {number} opts.vendorAmount  Naira clawed back from the seller.
 * @returns {{ entries: Object[], totalAmount: number, platformAmount: number,
 *             walletDebits: { account: string, userId, amount: number }[] }}
 */
function storeRefundEntries({ buyerId, sellerId, amount, vendorAmount }) {
  const refund = money.round(amount);
  const vendor = money.round(vendorAmount);

  const lines = [
    {
      account: "cash_account",
      userId: buyerId ?? null,
      debit: 0,
      credit: refund,
      description: "Refund paid to buyer",
    },
  ];
  if (vendor > 0) {
    lines.push({
      account: "wallet_vendor",
      userId: sellerId,
      debit: vendor,
      credit: 0,
      description: "Seller share of refund",
    });
  }

  const platform = money.subtract(refund, vendor);
  if (platform > 0) {
    lines.push({ account: PLATFORM, userId: null, debit: platform, credit: 0, description: "Platform margin returned" });
  } else if (platform < 0) {
    lines.push({
      account: PLATFORM,
      userId: null,
      debit: 0,
      credit: money.subtract(0, platform),
      description: "Platform margin returned (negative margin)",
    });
  }

  return {
    entries: lines,
    totalAmount: money.sum(lines, (l) => l.debit),
    platformAmount: platform,
    walletDebits: vendor > 0 ? [{ account: "wallet_vendor", userId: sellerId, amount: vendor }] : [],
  };
}

/**
 * Rebook the part of a refund a wallet cannot cover (the seller already
 * withdrew it) as owed by that wallet's owner: the wallet line shrinks to what
 * was actually recovered and an accounts_receivable line carries the rest.
 * Debits are only moved between lines, so the ledger stays balanced and
 * totalAmount is unchanged.
 *
 * @param {Object[]} entries      storeRefundEntries(...).entries
 * @param {{ userId, account: string, outstanding: number }[]} shortfalls
 * @returns {Object[]} new entries
 */
function withWalletShortfalls(entries, shortfalls) {
  const out = entries.map((e) => ({ ...e }));
  for (const { userId, account, outstanding } of shortfalls) {
    if (!(outstanding > 0)) continue;
    const line = out.find(
      (e) => e.account === account && e.debit > 0 && String(e.userId) === String(userId),
    );
    if (!line) throw new Error(`No ${account} refund line for ${userId}`);
    line.debit = money.subtract(line.debit, outstanding);
    out.push({
      account: "accounts_receivable",
      userId,
      debit: outstanding,
      credit: 0,
      description: "Refund share owed by seller (wallet already withdrawn)",
    });
  }
  return out.filter((e) => e.debit > 0 || e.credit > 0);
}

module.exports = { orderPaymentEntries, storeRefundEntries, withWalletShortfalls };
