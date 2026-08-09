const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const redisClient = require("../../config/redisClient");

// 60 seconds. Every write path that changes this payload calls
// invalidateDispatchProfile (utils/dispatchProfileCache), so a successful
// update is always visible on the very next read rather than up to a minute
// later.
const TTL = 60;

/**
 * @function getDispatchProfile
 * @description Get the authenticated agent's dispatch profile, including the
 *              `setupLevel` and `setupSteps` onboarding checklist.
 */
const getDispatchProfile = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const cacheKey = `dispatch:profile:${_id}`;

  // ── Cache read ────────────────────────────────────────────────────────────
  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  // NOT .lean() — `setupLevel` and `setupSteps` are schema virtuals, and
  // mongoose only applies virtuals to lean results via the
  // mongoose-lean-virtuals plugin, which this project does not install. A lean
  // read dropped both fields from the payload, leaving the onboarding screen
  // with no progress to show. toJSON() applies them (the schema sets
  // `toJSON: { virtuals: true }`).
  const doc = await DispatchProfile.findOne({ user: _id }).populate(
    "user",
    "firstname lastname fullName email mobile image state city residentialAddress nextOfKin modeOfTransport",
  );

  if (!doc) {
    return res.status(404).json({
      success: false,
      message: "Dispatch profile not found",
    });
  }

  const dispatchProfile = doc.toJSON();

  // Mongoose minimizes an all-empty nested object away, so a rider who has not
  // filled in their next of kin gets no `nextOfKin` key at all and the edit
  // screen has no shape to bind to. Emit the full shape with nulls, matching
  // GET /api/user/me.
  if (dispatchProfile.user) {
    dispatchProfile.user.nextOfKin = {
      name: dispatchProfile.user.nextOfKin?.name ?? null,
      mobile: dispatchProfile.user.nextOfKin?.mobile ?? null,
    };
    dispatchProfile.user.modeOfTransport =
      dispatchProfile.user.modeOfTransport ?? null;
  }

  const payload = { success: true, data: dispatchProfile };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch (_) {}

  res.json(payload);
});

module.exports = getDispatchProfile;
