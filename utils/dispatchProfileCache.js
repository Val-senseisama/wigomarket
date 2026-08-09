const redisClient = require("../config/redisClient");

/**
 * GET /api/delivery-agent/profile caches its payload for 60 s. Every write path
 * that can change what that payload contains must clear the key, otherwise the
 * agent keeps reading their old vehicle type / documents / status for up to a
 * minute after a successful update.
 *
 * The payload embeds the populated User document as well as the dispatch
 * profile, so rider-account edits (name, mobile, next of kin, …) invalidate it
 * too — not just dispatch-profile edits.
 *
 * Redis being down must never fail the write that already committed, so the
 * delete is best-effort.
 *
 * @param {string|import("mongoose").Types.ObjectId} userId - the profile owner's
 *   User id (NOT the DispatchProfile _id).
 */
async function invalidateDispatchProfile(userId) {
  if (!userId) return;
  try {
    await redisClient.del(`dispatch:profile:${userId}`);
  } catch (_) {}
}

module.exports = { invalidateDispatchProfile };
