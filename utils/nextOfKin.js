/**
 * Next of kin serialization for rider-facing payloads.
 *
 * Two separate problems make the raw stored value unusable by the edit form:
 *
 *   1. Mongoose minimizes an all-empty nested object away, so a rider who never
 *      filled it in has no `nextOfKin` key at all and the form has no shape to
 *      bind to.
 *   2. Riders onboarded before the write paths rejected blanks have `""` stored
 *      for one or both fields. An empty string reads back as a filled-in-but-
 *      empty contact, which is indistinguishable from a save that silently did
 *      nothing.
 *
 * Every endpoint that emits nextOfKin runs it through here so the client sees
 * exactly one representation of "not set": `null`.
 */

/**
 * Serialize a stored nextOfKin subdocument for an API response.
 *
 * Always returns both keys. Absent, blank and whitespace-only values all
 * collapse to null; real values are trimmed.
 *
 * @param {unknown} value - The stored `user.nextOfKin`, possibly undefined.
 * @returns {{ name: string|null, mobile: string|null }}
 */
function serializeNextOfKin(value) {
  return {
    name: blankToNull(value?.name),
    mobile: blankToNull(value?.mobile),
  };
}

/**
 * @param {unknown} field
 * @returns {string|null}
 */
function blankToNull(field) {
  if (typeof field !== "string") return null;
  const trimmed = field.trim();
  return trimmed === "" ? null : trimmed;
}

module.exports = { serializeNextOfKin };
