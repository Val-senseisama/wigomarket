const { DateTime } = require("luxon");

const LAGOS = "Africa/Lagos";
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse one end of a dashboard date-range filter (dateFrom / dateTo).
 *
 * A bare date ("2026-10-01") is a whole Africa/Lagos day: the start of it for
 * `edge: "start"`, the end of it for `edge: "end"` — so picking the same day
 * for both returns that entire day. Anything else is parsed as an instant.
 *
 * @param {*} raw
 * @param {"start"|"end"} edge
 * @returns {Date|null|false} Date; null when absent; false when unparseable.
 */
const parseDateBound = (raw, edge) => {
  if (raw == null || raw === "") return null;
  const value = String(raw).trim();

  if (BARE_DATE.test(value)) {
    const day = DateTime.fromISO(value, { zone: LAGOS });
    if (!day.isValid) return false;
    return (edge === "start" ? day.startOf("day") : day.endOf("day")).toJSDate();
  }

  const instant = new Date(value);
  return isNaN(instant) ? false : instant;
};

/**
 * Parse a dateFrom/dateTo pair into a Mongo range on `field`.
 *
 * @returns {{ filter: Object } | { error: string }} filter is {} when neither is set.
 */
const parseDateRange = (dateFrom, dateTo, field = "createdAt") => {
  const from = parseDateBound(dateFrom, "start");
  const to = parseDateBound(dateTo, "end");

  if (from === false) {
    return { error: `Invalid dateFrom: "${dateFrom}". Use an ISO date, e.g. 2026-10-01.` };
  }
  if (to === false) {
    return { error: `Invalid dateTo: "${dateTo}". Use an ISO date, e.g. 2026-10-01.` };
  }
  if (from && to && from > to) {
    return { error: "dateFrom must be on or before dateTo" };
  }

  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return { filter: Object.keys(range).length ? { [field]: range } : {} };
};

module.exports = { parseDateBound, parseDateRange };
