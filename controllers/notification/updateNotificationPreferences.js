const asyncHandler = require("express-async-handler");
const NotificationPreferences = require("../../models/notificationPreferencesModel");
const audit = require("../../services/auditService");
const {
  buildPreferenceUpdate,
  serializePreferences,
} = require("../../utils/notificationPreferences");

/**
 * @function updateNotificationPreferences
 * @description Self-service edit of the authenticated user's notification
 *              settings. Partial: only the keys present in the body change, so
 *              `{ pushNotifications: { promotions: false } }` flips that single
 *              toggle and leaves every other one alone. Unknown keys, non-boolean
 *              toggles, bad enum values, malformed quiet-hours times and invalid
 *              timezones are rejected with 400.
 *
 * @body {Object}  [pushNotifications]   - { enabled, orderUpdates, deliveryUpdates, promotions, securityAlerts, systemUpdates, chatMessages, ratingReminders }
 * @body {Object}  [emailNotifications]  - { enabled, orderUpdates, deliveryUpdates, promotions, securityAlerts, systemUpdates, weeklyDigest, monthlyReport }
 * @body {Object}  [smsNotifications]    - { enabled, orderUpdates, deliveryUpdates, securityAlerts, verificationCodes }
 * @body {Object}  [quietHours]          - { enabled, startTime "HH:mm", endTime "HH:mm", timezone }
 * @body {Object}  [frequency]           - { push, email }
 * @body {string}  [language]
 */
const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const { _id } = req.user;

  const result = buildPreferenceUpdate(req.body);
  if (result.error) {
    return res.status(400).json({ success: false, message: result.error });
  }

  const preferences = await NotificationPreferences.findOneAndUpdate(
    { user: _id },
    { $set: { ...result.updates, lastUpdated: new Date() } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  );

  audit.log({
    action: "user.notification_preferences_updated",
    actor: audit.actor(req),
    resource: { type: "user", id: _id },
    changes: { after: result.updates },
  });

  res.json({
    success: true,
    message: "Notification preferences updated successfully",
    data: serializePreferences(preferences),
  });
});

module.exports = updateNotificationPreferences;
