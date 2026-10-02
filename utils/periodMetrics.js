/**
 * Period windows and dashboard-tile metrics shared by the seller dashboard
 * cards (Business Analytics, Earnings Summary).
 *
 * Every period is compared against the same elapsed span one period earlier —
 * "today so far" against "yesterday up to this time", not against the whole of
 * yesterday. Comparing a part-day against a full day makes every morning look
 * like a collapse.
 */

const { fromKobo } = require("./money");

const LAGOS = "Africa/Lagos";

// period key → the luxon unit its window is anchored on.
const PERIOD_UNITS = {
  today: "day",
  weekly: "week",
  monthly: "month",
};

/**
 * Current and preceding window for a period key, as JS Dates.
 * @param {string} key   today | weekly | monthly
 * @param {import("luxon").DateTime} now  Already zoned to LAGOS.
 */
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

/** Percentage change, to one decimal place. */
function changePercent(value, previous) {
  if (previous === 0) return value === 0 ? 0 : 100;
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

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

module.exports = {
  LAGOS,
  PERIOD_UNITS,
  windowFor,
  changePercent,
  metric,
  moneyMetric,
};
