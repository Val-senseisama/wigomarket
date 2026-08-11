/**
 * Working days for a dispatch agent's availability schedule.
 *
 * Stored at `availability.workingDays` on the dispatch profile, but both
 * POST /api/delivery-agent/profile and PUT /api/delivery-agent/profile accept it
 * as a TOP-LEVEL `workingDays` key (that is what the API docs have always shown
 * and what the mobile app sends). The update controller maps it onto the nested
 * path — sending it top-level used to be silently discarded by mongoose strict
 * mode, so the agent's schedule never changed and the response just echoed the
 * stored value back.
 */
const WORKING_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_SET = new Set(WORKING_DAYS);

/**
 * Validate and canonicalise a working-days list.
 *
 * Accepts any casing and surrounding whitespace, and drops duplicates while
 * keeping the order the caller sent. An agent may work any number of days from
 * one to seven — there is no cap.
 *
 * @param {unknown} value
 * @returns {{ days: string[] } | { error: string }}
 */
function normalizeWorkingDays(value) {
  if (!Array.isArray(value)) {
    return { error: "workingDays must be an array of day names" };
  }
  if (value.length === 0) {
    return { error: "workingDays must contain at least one day" };
  }

  const days = [];
  for (const raw of value) {
    if (typeof raw !== "string") {
      return { error: `workingDays must contain only day names. Valid days: ${WORKING_DAYS.join(", ")}` };
    }
    const day = raw.trim().toLowerCase();
    if (!DAY_SET.has(day)) {
      return { error: `"${raw}" is not a valid working day. Valid days: ${WORKING_DAYS.join(", ")}` };
    }
    if (!days.includes(day)) days.push(day);
  }

  return { days };
}

module.exports = { WORKING_DAYS, normalizeWorkingDays };
