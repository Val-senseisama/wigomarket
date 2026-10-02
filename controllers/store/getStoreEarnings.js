const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const { DateTime } = require("luxon");
const Order = require("../../models/orderModel");
const { toKobo, fromKobo } = require("../../utils/money");
const { formatOrderNumber } = require("../../utils/orderSerializer");
const { LAGOS, windowFor, moneyMetric } = require("../../utils/periodMetrics");
const { parseDateRange } = require("../../utils/dateRange");
const {
  PAID_PAYMENT_STATUSES,
  EARNING_STATUSES,
  perOrderEarnings,
  netOfRefunds,
} = require("../../services/storeEarningsPipeline");

/**
 * @function getStoreEarnings
 * @description The seller's "Earnings & Transactions" screen in one call: the
 *              Earnings Summary cards (total / weekly / today) and the paginated
 *              Recent Earnings table.
 *
 * @access Seller only (isSeller sets req.store)
 *
 * What counts as an earning: an order containing this store's products whose
 * payment has gone through. The vendor share is credited at payment time (see
 * webhookPaymentProcessor), so a paid order is an earned order — delivery is
 * not a precondition.
 *
 * Refunds: buyers ask the seller for refunds (services/orderRefundService).
 * Once a refund is settled, the seller's share of it is subtracted from that
 * order's earning: `amountEarned` is what the store keeps, with `grossAmount`
 * and `refundedAmount` alongside. Row status is this store's own position —
 * paid, partially_refunded or refunded — and fully refunded rows stay in the
 * table at ₦0.
 *
 * Amount earned = this store's line items only, at vendor price (`price`, what
 * the store is paid — not `listedPrice`, which includes the platform margin),
 * as snapshotted on the order when it was placed.
 * Multi-store orders are split; delivery fees go to the rider and are excluded.
 *
 * Query params (all optional):
 *   search    — order number, product name, customer name, or an amount
 *               ("5000", "₦5,000", "5,000.50" all match ₦5,000.00 earned)
 *   dateFrom  — inclusive lower bound on order date. A bare date (2026-10-01)
 *               means the start of that day in Africa/Lagos.
 *   dateTo    — inclusive upper bound on order date. A bare date means the
 *               *end* of that day, so dateFrom=dateTo=<day> returns that day.
 *   status    — paid | partially_refunded | refunded (default: all)
 *   sortBy    — date | amount   (default date)
 *   sortOrder — asc | desc      (default desc)
 *   page      — default 1
 *   limit     — default 10, max 100
 *   summary   — false to skip the cards (e.g. when only paging the table)
 *
 * The summary cards always cover the whole store — they ignore search, date
 * and status filters, matching the design where the cards sit above the table.
 *
 * Money: all sums are integer kobo inside the aggregation, converted to naira
 * once via utils/money.
 */

const SORTABLE = { date: "createdAt", amount: "earnedKobo" };

class EarningsQueryError extends Error {}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseStatuses = (raw) => {
  if (raw == null || raw === "") return Object.keys(EARNING_STATUSES);
  const tokens = (Array.isArray(raw) ? raw : [raw])
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  const unknown = tokens.filter((t) => !EARNING_STATUSES[t]);
  if (unknown.length) {
    throw new EarningsQueryError(
      `Invalid status: ${unknown.join(", ")}. Must be one of: ${Object.keys(EARNING_STATUSES).join(", ")}`,
    );
  }
  return [...new Set(tokens)];
};

/**
 * "₦5,000", "NGN 5000.50", "5000" → kobo, or null when the term is not an
 * amount. Requires at least one digit and nothing but money punctuation, so a
 * product name containing digits ("40 Pack") is not mistaken for an amount.
 */
const searchAmountKobo = (term) => {
  const cleaned = term.replace(/^(₦|ngn|n)\s*/i, "").replace(/[,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return toKobo(Number(cleaned));
};

const searchStage = (search) => {
  const term = String(search ?? "").trim();
  if (!term) return [];

  const rx = new RegExp(escapeRegex(term.replace(/^#/, "")), "i");
  const or = [
    { orderNumber: rx },
    { "items.title": rx },
    { customerName: rx },
  ];

  const kobo = searchAmountKobo(term);
  if (kobo !== null) or.push({ earnedKobo: kobo });

  return [{ $match: { $or: or } }];
};

const inWindow = (from, to) => ({
  $and: [{ $gte: ["$earnedAt", from] }, { $lt: ["$earnedAt", to] }],
});

const sumWhen = (cond) => ({ $sum: { $cond: [cond, "$earnedKobo", 0] } });

/**
 * The three cards. Weekly and Today compare against the same elapsed span one
 * period earlier, exactly like Business Analytics. Total Earnings compares the
 * lifetime total now against the lifetime total at the start of this month, so
 * its badge reads as "how much this month has grown your total".
 */
const buildSummary = async (storeId, now) => {
  const today = windowFor("today", now);
  const weekly = windowFor("weekly", now);
  const monthStart = now.startOf("month").toJSDate();

  const [row = {}] = await Order.aggregate([
    { $match: { "products.store": storeId, paymentStatus: { $in: PAID_PAYMENT_STATUSES } } },
    ...perOrderEarnings(storeId),
    ...netOfRefunds(storeId),
    {
      $group: {
        _id: null,
        total: { $sum: "$earnedKobo" },
        totalBeforeMonth: sumWhen({ $lt: ["$earnedAt", monthStart] }),
        weekCurrent: sumWhen(inWindow(weekly.from, weekly.to)),
        weekPrevious: sumWhen(inWindow(weekly.previousFrom, weekly.previousTo)),
        todayCurrent: sumWhen(inWindow(today.from, today.to)),
        todayPrevious: sumWhen(inWindow(today.previousFrom, today.previousTo)),
        paidOrders: { $sum: { $cond: [{ $eq: ["$earningStatus", "refunded"] }, 0, 1] } },
      },
    },
  ]);

  const k = (field) => Math.round(row[field] || 0);

  return {
    totalEarnings: moneyMetric(k("total"), k("totalBeforeMonth")),
    weeklyEarnings: moneyMetric(k("weekCurrent"), k("weekPrevious")),
    todayEarnings: moneyMetric(k("todayCurrent"), k("todayPrevious")),
    paidOrders: row.paidOrders || 0,
    ranges: {
      total: { previousTo: monthStart.toISOString() },
      weekly: rangeOut(weekly),
      today: rangeOut(today),
    },
  };
};

const rangeOut = (w) => ({
  from: w.from.toISOString(),
  to: w.to.toISOString(),
  previousFrom: w.previousFrom.toISOString(),
  previousTo: w.previousTo.toISOString(),
});

const customerNameExpr = {
  $let: {
    vars: { c: { $arrayElemAt: ["$customer", 0] } },
    in: {
      $ifNull: [
        "$$c.fullName",
        {
          $trim: {
            input: {
              $concat: [
                { $ifNull: ["$$c.firstname", ""] },
                " ",
                { $ifNull: ["$$c.lastname", ""] },
              ],
            },
          },
        },
      ],
    },
  },
};

const serializeEarning = (row) => {
  const items = row.items.map((item) => ({
    productId: item.productId,
    title: item.title ?? "Deleted product",
    image: item.image ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice ?? 0,
    amount: fromKobo(Math.round(item.kobo || 0)),
  }));

  const [first] = items;
  const more = items.length - 1;

  return {
    id: row._id,
    orderNumber: formatOrderNumber(row),
    // The "Product Sold" cell. The full list is in `products`.
    productSold: more > 0 ? `${first.title} +${more} more` : first?.title ?? null,
    products: items,
    customer: { id: row.orderedBy ?? null, name: row.customerName || null },
    orderDate: row.createdAt,
    earnedAt: row.earnedAt,
    // What the store keeps: the order's earning less any settled refunds.
    amountEarned: fromKobo(Math.round(row.earnedKobo || 0)),
    grossAmount: fromKobo(Math.round(row.grossKobo || 0)),
    refundedAmount: fromKobo(Math.round(row.refundedKobo || 0)),
    currency: "NGN",
    status: row.earningStatus,
    statusLabel: EARNING_STATUSES[row.earningStatus] ?? row.earningStatus,
  };
};

const listEarnings = async (storeId, query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
  const skip = (page - 1) * limit;

  const dates = parseDateRange(query.dateFrom, query.dateTo);
  if (dates.error) throw new EarningsQueryError(dates.error);

  const statuses = parseStatuses(query.status);
  const match = {
    "products.store": storeId,
    paymentStatus: { $in: PAID_PAYMENT_STATUSES },
    ...dates.filter,
  };

  const sortField = SORTABLE[String(query.sortBy || "").toLowerCase()] || "createdAt";
  const direction = String(query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;

  const [result] = await Order.aggregate([
    { $match: match },
    ...perOrderEarnings(storeId),
    ...netOfRefunds(storeId),
    { $match: { earningStatus: { $in: statuses } } },
    {
      $lookup: {
        from: "users",
        localField: "orderedBy",
        foreignField: "_id",
        pipeline: [{ $project: { fullName: 1, firstname: 1, lastname: 1 } }],
        as: "customer",
      },
    },
    { $addFields: { customerName: customerNameExpr } },
    ...searchStage(query.search),
    {
      $facet: {
        rows: [
          { $sort: { [sortField]: direction, _id: direction } },
          { $skip: skip },
          { $limit: limit },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const total = result.total[0]?.n ?? 0;

  return {
    earnings: result.rows.map(serializeEarning),
    pagination: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      hasMore: skip + result.rows.length < total,
    },
  };
};

const getStoreEarnings = asyncHandler(async (req, res) => {
  if (!req.store) {
    return res.status(404).json({
      success: false,
      message: "No store found for this account",
    });
  }

  const storeId = new mongoose.Types.ObjectId(req.store);
  const now = DateTime.now().setZone(LAGOS);
  const wantSummary = String(req.query.summary ?? "true").toLowerCase() !== "false";

  let table;
  let summary;
  try {
    [table, summary] = await Promise.all([
      listEarnings(storeId, req.query),
      wantSummary ? buildSummary(storeId, now) : undefined,
    ]);
  } catch (err) {
    if (err instanceof EarningsQueryError) {
      return res.status(400).json({ success: false, message: err.message });
    }
    throw err;
  }

  res.json({
    success: true,
    data: {
      currency: "NGN",
      timezone: LAGOS,
      generatedAt: now.toISO(),
      ...(summary && { summary }),
      ...table,
    },
  });
});

module.exports = getStoreEarnings;
