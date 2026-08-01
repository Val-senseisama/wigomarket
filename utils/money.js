/**
 * @file money.js
 * @description Exact money arithmetic for NGN amounts.
 *
 * Money is stored throughout this codebase as a Number of naira. Doing
 * arithmetic directly on those Numbers accumulates IEEE-754 error — the classic
 * symptom being a wallet balance that drifts a fraction of a kobo away from the
 * sum of its ledger entries, which then makes reconciliation ambiguous.
 *
 * Every function here converts to **integer kobo**, does the arithmetic on
 * integers (exact up to 2^53 kobo ≈ ₦90 trillion), and converts back to a naira
 * value that is exactly representable at 2 decimal places. Chaining these never
 * accumulates error, because every intermediate result is re-normalised to a
 * whole number of kobo.
 *
 * RULE: never use raw +, -, * or / on a money value. Use these helpers.
 *
 * Storing minor units directly in MongoDB would be stronger still — see
 * scripts/migrateMoneyToKobo.js for the staged path to that.
 */

const KOBO_PER_NAIRA = 100;

// 2^53 - 1 kobo. Beyond this, integer arithmetic stops being exact.
const MAX_SAFE_KOBO = Number.MAX_SAFE_INTEGER;

/**
 * Convert a naira amount to whole kobo.
 *
 * Rounds half away from zero, matching how currency is conventionally rounded
 * (and how Nigerian banking statements present it). The epsilon nudge absorbs
 * representation error in values that are already "as good as" 2dp — e.g.
 * 0.29999999999999993 must become 30 kobo, not 29.
 *
 * @param {number} naira
 * @returns {number} integer kobo
 */
function toKobo(naira) {
  const n = Number(naira);
  if (!Number.isFinite(n)) {
    throw new TypeError(`Not a finite money value: ${naira}`);
  }

  const scaled = n * KOBO_PER_NAIRA;
  const nudged =
    scaled >= 0
      ? scaled + Math.abs(scaled) * Number.EPSILON
      : scaled - Math.abs(scaled) * Number.EPSILON;
  const kobo = Math.round(nudged);

  if (!Number.isSafeInteger(kobo)) {
    throw new RangeError(`Money value out of safe range: ${naira}`);
  }
  return kobo;
}

/**
 * Convert whole kobo back to a naira Number.
 * @param {number} kobo
 * @returns {number} naira, exact to 2dp
 */
function fromKobo(kobo) {
  if (!Number.isInteger(kobo)) {
    throw new TypeError(`Kobo must be an integer: ${kobo}`);
  }
  if (Math.abs(kobo) > MAX_SAFE_KOBO) {
    throw new RangeError(`Kobo value out of safe range: ${kobo}`);
  }
  return kobo / KOBO_PER_NAIRA;
}

/**
 * Normalise a naira value to a whole number of kobo.
 * Use on any value entering the system from outside (request bodies, providers).
 * @param {number} naira
 * @returns {number}
 */
function round(naira) {
  return fromKobo(toKobo(naira));
}

/**
 * Exact sum. add(1.1, 2.2) === 3.3, not 3.3000000000000003.
 * @param {...number} amounts
 * @returns {number}
 */
function add(...amounts) {
  return fromKobo(amounts.reduce((acc, a) => acc + toKobo(a), 0));
}

/**
 * Exact subtraction: a − b − …
 * @param {number} a
 * @param {...number} rest
 * @returns {number}
 */
function subtract(a, ...rest) {
  return fromKobo(rest.reduce((acc, b) => acc - toKobo(b), toKobo(a)));
}

/**
 * Multiply a money amount by a dimensionless factor (quantity, rate, distance).
 * The factor is NOT money, so it is used as-is; the product is rounded to whole
 * kobo. Rounds half away from zero.
 *
 * @param {number} amount - money
 * @param {number} factor - plain number
 * @returns {number}
 */
function multiply(amount, factor) {
  const f = Number(factor);
  if (!Number.isFinite(f)) {
    throw new TypeError(`Not a finite factor: ${factor}`);
  }
  const product = toKobo(amount) * f;
  const kobo = product >= 0 ? Math.round(product) : -Math.round(-product);
  if (!Number.isSafeInteger(kobo)) {
    throw new RangeError(`Money value out of safe range: ${amount} * ${factor}`);
  }
  return fromKobo(kobo);
}

/**
 * Take a percentage of a money amount. percentage(1000, 2) === 20.
 * @param {number} amount
 * @param {number} percent - e.g. 7.5 for 7.5%
 * @returns {number}
 */
function percentage(amount, percent) {
  return multiply(amount, Number(percent) / 100);
}

/**
 * Exact sum over an array, optionally via a selector.
 * @param {Array} items
 * @param {(item: any) => number} [selector]
 * @returns {number}
 */
function sum(items, selector = (x) => x) {
  return fromKobo(
    items.reduce((acc, item) => acc + toKobo(selector(item) || 0), 0),
  );
}

/** Largest of the given money amounts. */
function max(...amounts) {
  return fromKobo(Math.max(...amounts.map(toKobo)));
}

/** Smallest of the given money amounts. */
function min(...amounts) {
  return fromKobo(Math.min(...amounts.map(toKobo)));
}

/**
 * Exact equality at kobo precision. Use instead of `a === b` on money.
 * @returns {boolean}
 */
function equals(a, b) {
  return toKobo(a) === toKobo(b);
}

/**
 * Compare two money amounts at kobo precision.
 * @returns {-1 | 0 | 1}
 */
function compare(a, b) {
  const ka = toKobo(a);
  const kb = toKobo(b);
  if (ka < kb) return -1;
  if (ka > kb) return 1;
  return 0;
}

/** a >= b at kobo precision. */
const gte = (a, b) => compare(a, b) >= 0;
/** a <= b at kobo precision. */
const lte = (a, b) => compare(a, b) <= 0;
/** a > b at kobo precision. */
const gt = (a, b) => compare(a, b) > 0;
/** a < b at kobo precision. */
const lt = (a, b) => compare(a, b) < 0;

/**
 * Split an amount into n parts that sum back to exactly the original.
 * Remainder kobo are distributed one each to the leading parts, so no fraction
 * is created or destroyed — the classic "penny allocation" problem.
 *
 * @param {number} amount
 * @param {number} parts
 * @returns {number[]}
 */
function allocate(amount, parts) {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new TypeError(`parts must be a positive integer: ${parts}`);
  }
  const total = toKobo(amount);
  const base = Math.trunc(total / parts);
  let remainder = total - base * parts;

  return Array.from({ length: parts }, () => {
    let share = base;
    if (remainder > 0) {
      share += 1;
      remainder -= 1;
    } else if (remainder < 0) {
      share -= 1;
      remainder += 1;
    }
    return fromKobo(share);
  });
}

module.exports = {
  KOBO_PER_NAIRA,
  toKobo,
  fromKobo,
  round,
  add,
  subtract,
  multiply,
  percentage,
  sum,
  max,
  min,
  equals,
  compare,
  gte,
  lte,
  gt,
  lt,
  allocate,
};
