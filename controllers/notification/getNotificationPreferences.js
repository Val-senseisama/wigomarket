const asyncHandler = require("express-async-handler");
const NotificationPreferences = require("../../models/notificationPreferencesModel");
const { serializePreferences } = require("../../utils/notificationPreferences");

/**
 * @function getNotificationPreferences
 * @description The authenticated user's notification settings — the data behind
 *              the "Notification settings" screen for buyers, sellers and riders
 *              alike. A user who has never saved preferences gets the defaults,
 *              persisted on first read so the send path sees the same values.
 */
const getNotificationPreferences = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  // Atomic upsert rather than findOne + create, so two concurrent first reads
  // cannot race into a duplicate-key error on the unique `user` index.
  const preferences = await NotificationPreferences.findOneAndUpdate(
    { user: _id },
    { $setOnInsert: { user: _id } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.json({
    success: true,
    data: serializePreferences(preferences),
  });
});

module.exports = getNotificationPreferences;
