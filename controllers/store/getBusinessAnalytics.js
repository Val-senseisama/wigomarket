const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const { DateTime } = require("luxon");
const Order = require("../../models/orderModel");
const Product = require("../../models/productModel");
const { STATUS, statusMatchValues } = require("../../utils/orderStatus");
const { fromKobo } = require("../../utils/money");

/**
 * @function getBusinessAnalytics
 * @description The "Business Analytics" card on the seller dashboard: pending
 *              orders, total sales, completed orders and active products, each
 *              with the percentage change against the equivalent earlier window.
 *
 *              The `period` query param drives the Today / Weekly / Monthly
 *              toggle. It accepts one key, several comma-separated keys, or
 *              `all` — so the client can render one tile row or pre-load all
 *              three toggle states in a single round trip.
 *
 * @access Seller only (isSeller sets req.store)
 *
 * Query params:
 *   period — today | weekly | monthly | all | a comma-separated combination
 *            (default: today). `day`, `week` and `month` are accepted aliases.
 *
 * Comparison windows: each period is compared against the same elapsed span one
 * period earlier — "today so far" against "yesterday up to this time", not
 * against the whole of yesterday. Comparing a part-day against a full day makes
 * every morning look like a collapse in sales.
 *
 * Money: all sums are accumulated as integer kobo inside the aggregation and
 * converted back to naira exactly once, via utils/money. Summing naira doubles
 * in Mongo would reintroduce the float drift utils/money exists to prevent.
 */

const LAGOS = "Africa/Lagos";

// period key → the luxon unit its window is anchored on.
const PERIOD_UNITS = {
  today: "day",
  weekly: "week",
  monthly: "month",
};

// UI/shorthand spellings the client may send.
const PERIOD_ALIASES = {
  day: "today",
  daily: "today",
  today: "today",
  week: "weekly",
  weekly: "weekly",
  month: "monthly",
  monthly: "monthly",
};

const PENDING_VALUES = statusMatchValues(STATUS.PENDING);
const DELIVERED_VALUES = statusMatchValues(STATUS.DELIVERED);

/**
 * Resolve the `period` query param into an ordered, de-duplicated list of keys.
 * @returns {{ keys: string[] } | { error: string }}
 */
const parsePeriods = (raw) => {
  const requested = String(raw ?? "today").trim();
  if (!requested) return { keys: ["today"] };

  if (requested.toLowerCase() === "all") {
    return { keys: Object.keys(PERIOD_UNITS) };
  }

  const keys = [];
  for (const token of requested.split(",")) {
    const cleaned = token.trim().toLowerCase();
    if (!cleaned) continue;
    const key = PERIOD_ALIASES[cleaned];
    if (!key) {
      return {
        error: `Invalid period "${token.trim()}". Use today, weekly, monthly, all, or a comma-separated combination.`,
      };
    }
    if (!keys.includes(key)) keys.push(key);
  }

  return keys.length ? { keys } : { keys: ["today"] };
};

/** Current and preceding window for a period key, as JS Dates. */
const windowFor = (key, now) => {
  const unit = PERIOD_UNITS[key];
  const from = now.startOf(unit);
  const step = { [`${unit}s`]: 1 };

  return {
    from: from.toJSDate(),
    to: now.toJSDate(),
    previousFrom: from.minus(step).toJSDate(),
    previousTo: now.minus(step).toJSDate(),
  };
};

// ── Aggregation expression helpers ───────────────────────────────────────────

const inWindow = (field, from, to) => ({
  $and: [{ $gte: [field, from] }, { $lt: [field, to] }],
});

const hasStatus = (values) => ({ $in: ["$orderStatus", values] });

/** Integer kobo for one line item: unit price (naira) × quantity. */
const lineKobo = (priceExpr) => ({
  $multiply: [
    { $round: [{ $multiply: [priceExpr, 100] }, 0] },
    { $ifNull: ["$products.count", 0] },
  ],
});

/**
 * When an order reached "delivered". `actualDeliveryTime` is set on the rider
 * flow; pickup orders only leave a statusHistory entry; anything older than
 * both falls back to updatedAt so it still lands in some window rather than
 * being dropped from the sales figures entirely.
 */
const COMPLETED_AT = {
  $ifNull: [
    "$actualDeliveryTime",
    {
      $ifNull: [
        {
          $max: {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ["$statusHistory", []] },
                  as: "entry",
                  cond: { $eq: ["$$entry.status", STATUS.DELIVERED] },
                },
              },
              as: "entry",
              in: "$$entry.at",
            },
          },
        },
        "$updatedAt",
      ],
    },
  ],
};

/** { $sum: 1 } / { $sum: <field> } gated on a condition. */
const sumWhen = (cond, value = 1) => ({ $sum: { $cond: [cond, value, 0] } });

const getBusinessAnalytics = asyncHandler(async (req, res) => {
  if (!req.store) {
    return res.status(404).json({
      success: false,
      message: "No store found for this account",
    });
  }

  const parsed = parsePeriods(req.query.period);
  if (parsed.error) {
    return res.status(400).json({ success: false, message: parsed.error });
  }

  const storeId = new mongoose.Types.ObjectId(req.store);
  const now = DateTime.now().setZone(LAGOS);
  const windows = Object.fromEntries(
    parsed.keys.map((key) => [key, windowFor(key, now)]),
  );

  // Every bucket that needs its own set of accumulators: current and preceding
  // window for each requested period.
  const buckets = [];
  for (const [key, w] of Object.entries(windows)) {
    buckets.push({ name: `${key}_current`, from: w.from, to: w.to });
    buckets.push({ name: `${key}_previous`, from: w.previousFrom, to: w.previousTo });
  }

  // Orders created before the oldest window can still complete inside it, so
  // the pre-filter keys off updatedAt: it is >= createdAt and >= completedAt
  // for every order, which makes it a safe superset of both.
  const earliest = buckets.reduce(
    (min, b) => (b.from < min ? b.from : min),
    buckets[0].from,
  );

  const orderAccumulators = {};
  const productAccumulators = {};

  for (const { name, from, to } of buckets) {
    const placedInWindow = {
      $and: [hasStatus(PENDING_VALUES), inWindow("$createdAt", from, to)],
    };
    const completedInWindow = {
      $and: [hasStatus(DELIVERED_VALUES), inWindow("$completedAt", from, to)],
    };

    orderAccumulators[`${name}_pendingOrders`] = sumWhen(placedInWindow);
    orderAccumulators[`${name}_pendingValueKobo`] = sumWhen(placedInWindow, "$netKobo");
    orderAccumulators[`${name}_completedOrders`] = sumWhen(completedInWindow);
    orderAccumulators[`${name}_netSalesKobo`] = sumWhen(completedInWindow, "$netKobo");
    orderAccumulators[`${name}_grossSalesKobo`] = sumWhen(completedInWindow, "$grossKobo");

    // A live stock count has no "during the window" reading — it is a snapshot.
    // Taking it as of each window's end turns it into a comparable series.
    productAccumulators[`${name}_activeProducts`] = sumWhen({
      $lt: ["$createdAt", to],
    });
  }

  const [orderRows, productRows] = await Promise.all([
    Order.aggregate([
      { $match: { "products.store": storeId, updatedAt: { $gte: earliest } } },
      { $addFields: { completedAt: COMPLETED_AT } },
      // Orders can span several stores; keep only this store's line items so
      // the sales figures are the seller's own share, not the basket total.
      { $unwind: "$products" },
      { $match: { "products.store": storeId } },
      {
        $lookup: {
          from: "products",
          localField: "products.product",
          foreignField: "_id",
          as: "productDoc",
        },
      },
      { $unwind: { path: "$productDoc", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$_id",
          orderStatus: { $first: "$orderStatus" },
          createdAt: { $first: "$createdAt" },
          completedAt: { $first: "$completedAt" },
          // net = the vendor price the store is paid (see commissionService);
          // gross = the listed price the customer paid, the difference being
          // the platform's margin.
          netKobo: { $sum: lineKobo({ $ifNull: ["$productDoc.price", 0] }) },
          grossKobo: {
            $sum: lineKobo({
              $ifNull: [
                "$productDoc.listedPrice",
                { $ifNull: ["$productDoc.price", 0] },
              ],
            }),
          },
        },
      },
      { $group: { _id: null, ...orderAccumulators } },
    ]),
    Product.aggregate([
      { $match: { store: storeId, quantity: { $gt: 0 } } },
      { $group: { _id: null, ...productAccumulators } },
    ]),
  ]);

  const orders = orderRows[0] || {};
  const products = productRows[0] || {};

  const count = (bucket, field) => orders[`${bucket}_${field}`] || 0;
  const kobo = (bucket, field) => Math.round(orders[`${bucket}_${field}`] || 0);

  const data = {
    period: parsed.keys[0],
    currency: "NGN",
    generatedAt: now.toISO(),
    timezone: LAGOS,
    periods: {},
  };

  for (const key of parsed.keys) {
    const cur = `${key}_current`;
    const prev = `${key}_previous`;
    const w = windows[key];

    data.periods[key] = {
      range: {
        from: w.from.toISOString(),
        to: w.to.toISOString(),
        previousFrom: w.previousFrom.toISOString(),
        previousTo: w.previousTo.toISOString(),
      },
      pendingOrders: metric(count(cur, "pendingOrders"), count(prev, "pendingOrders")),
      pendingOrdersValue: moneyMetric(kobo(cur, "pendingValueKobo"), kobo(prev, "pendingValueKobo")),
      totalSales: moneyMetric(kobo(cur, "netSalesKobo"), kobo(prev, "netSalesKobo")),
      grossSales: moneyMetric(kobo(cur, "grossSalesKobo"), kobo(prev, "grossSalesKobo")),
      completedOrders: metric(count(cur, "completedOrders"), count(prev, "completedOrders")),
      activeProducts: metric(
        products[`${cur}_activeProducts`] || 0,
        products[`${prev}_activeProducts`] || 0,
      ),
    };
  }

  // Convenience alias so a single-period request can read straight off `metrics`
  // without knowing which key it asked for.
  data.metrics = data.periods[parsed.keys[0]];

  res.json({ success: true, data });
});

/**
 * One tile: the current figure, what it was over the comparison window, and the
 * change between them.
 *
 * A rise from zero has no defined percentage — it is reported as +100% so the
 * tile shows growth rather than a misleading 0%, with `previous: 0` there for a
 * client that wants to render "new" instead.
 */
function metric(value, previous) {
  return { value, previous, changePercent: changePercent(value, previous) };
}

/**
 * Same as metric(), for money. The percentage is derived from the integer kobo
 * and the naira figures are produced only at the end, so no money value is ever
 * an operand of a raw arithmetic expression.
 */
function moneyMetric(valueKobo, previousKobo) {
  return {
    value: fromKobo(valueKobo),
    previous: fromKobo(previousKobo),
    changePercent: changePercent(valueKobo, previousKobo),
  };
}

/** Percentage change, to one decimal place. */
function changePercent(value, previous) {
  if (previous === 0) return value === 0 ? 0 : 100;
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

module.exports = getBusinessAnalytics;
