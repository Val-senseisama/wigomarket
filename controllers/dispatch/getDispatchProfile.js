const asyncHandler = require("express-async-handler");
const DispatchProfile = require("../../models/dispatchProfileModel");
const redisClient = require("../../config/redisClient");

const TTL = 60; // 60 seconds — invalidated on every profile mutation

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

  const dispatchProfile = await DispatchProfile.findOne({ user: _id })
    .populate("user", "firstname lastname email mobile image state city")
    .lean({ virtuals: true });

  if (!dispatchProfile) {
    return res.status(404).json({
      success: false,
      message: "Dispatch profile not found",
    });
  }

  const payload = { success: true, data: dispatchProfile };

  // ── Cache write ───────────────────────────────────────────────────────────
  try {
    await redisClient.setex(cacheKey, TTL, JSON.stringify(payload));
  } catch (_) {}

  res.json(payload);
});

module.exports = getDispatchProfile;
