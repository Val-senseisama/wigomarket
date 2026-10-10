const NotificationPreferences = require("../models/notificationPreferencesModel");
const {
  buildPreferenceUpdate,
  serializePreferences,
} = require("../utils/notificationPreferences");

describe("buildPreferenceUpdate", () => {
  it("flattens a partial nested body into dot paths so siblings are untouched", () => {
    expect(buildPreferenceUpdate({ pushNotifications: { promotions: false } })).toEqual({
      updates: { "pushNotifications.promotions": false },
    });
  });

  it("accepts every group in one request", () => {
    const { updates, error } = buildPreferenceUpdate({
      pushNotifications: { enabled: true, chatMessages: false },
      emailNotifications: { weeklyDigest: true },
      smsNotifications: { orderUpdates: true },
      quietHours: { enabled: true, startTime: "22:30", endTime: "07:00", timezone: "Africa/Lagos" },
      frequency: { push: "batched", email: "weekly" },
      language: "fr",
    });
    expect(error).toBeUndefined();
    expect(updates).toEqual({
      "pushNotifications.enabled": true,
      "pushNotifications.chatMessages": false,
      "emailNotifications.weeklyDigest": true,
      "smsNotifications.orderUpdates": true,
      "quietHours.enabled": true,
      "quietHours.startTime": "22:30",
      "quietHours.endTime": "07:00",
      "quietHours.timezone": "Africa/Lagos",
      "frequency.push": "batched",
      "frequency.email": "weekly",
      language: "fr",
    });
  });

  it("refuses to let a client write protected fields", () => {
    for (const key of ["user", "_id", "lastUpdated", "createdAt", "__v"]) {
      expect(buildPreferenceUpdate({ [key]: "x" }).error).toMatch(/Unknown preference/);
    }
  });

  it("rejects unknown keys instead of silently ignoring them", () => {
    expect(buildPreferenceUpdate({ pushNotifications: { promos: false } }).error).toBe(
      "Unknown preference: pushNotifications.promos",
    );
    expect(buildPreferenceUpdate({ whatsapp: { enabled: true } }).error).toBe(
      "Unknown preference: whatsapp",
    );
  });

  it("requires real booleans for toggles", () => {
    expect(buildPreferenceUpdate({ pushNotifications: { enabled: "false" } }).error).toMatch(
      /true or false/,
    );
    expect(buildPreferenceUpdate({ emailNotifications: { promotions: 0 } }).error).toMatch(
      /true or false/,
    );
  });

  it("rejects a scalar where a group is expected", () => {
    expect(buildPreferenceUpdate({ pushNotifications: false }).error).toBe(
      "pushNotifications must be an object",
    );
  });

  it("validates enums, quiet-hours times and timezones", () => {
    expect(buildPreferenceUpdate({ frequency: { push: "weekly" } }).error).toMatch(/one of/);
    expect(buildPreferenceUpdate({ language: "de" }).error).toMatch(/one of/);
    expect(buildPreferenceUpdate({ quietHours: { startTime: "25:00" } }).error).toMatch(/HH:mm/);
    expect(buildPreferenceUpdate({ quietHours: { endTime: "7:00" } }).error).toMatch(/HH:mm/);
    expect(buildPreferenceUpdate({ quietHours: { timezone: "Mars/Olympus" } }).error).toMatch(
      /timezone/,
    );
  });

  it("rejects an empty or non-object body", () => {
    expect(buildPreferenceUpdate({}).error).toBeDefined();
    expect(buildPreferenceUpdate(null).error).toBeDefined();
    expect(buildPreferenceUpdate([]).error).toBeDefined();
  });
});

describe("serializePreferences", () => {
  it("returns the full default shape when nothing is stored", () => {
    const out = serializePreferences(null);
    expect(out.pushNotifications.enabled).toBe(true);
    expect(out.emailNotifications.promotions).toBe(false);
    expect(out.smsNotifications.enabled).toBe(false);
    expect(out.quietHours).toEqual({
      enabled: false,
      startTime: "22:00",
      endTime: "08:00",
      timezone: "Africa/Lagos",
    });
    expect(out.frequency).toEqual({ push: "immediate", email: "immediate" });
    expect(out.language).toBe("en");
  });

  it("does not leak internal fields", () => {
    const doc = new NotificationPreferences({ user: "64b000000000000000000001" });
    const out = serializePreferences(doc);
    expect(out).not.toHaveProperty("user");
    expect(out).not.toHaveProperty("_id");
    expect(out).not.toHaveProperty("__v");
  });
});

describe("shouldReceiveNotification quiet hours", () => {
  afterEach(() => jest.useRealTimers());

  const prefsWithQuietHours = (startTime, endTime) =>
    new NotificationPreferences({
      user: "64b000000000000000000001",
      quietHours: { enabled: true, startTime, endTime, timezone: "Africa/Lagos" },
    });

  // Africa/Lagos is UTC+1 with no DST.
  const at = (hh, mm) => jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 1, hh - 1, mm)));

  it("mutes push across an overnight window, including just after midnight", () => {
    const prefs = prefsWithQuietHours("22:00", "08:00");
    at(23, 30);
    expect(prefs.shouldReceiveNotification("orderUpdates", "push")).toBe(false);
    at(0, 15);
    expect(prefs.shouldReceiveNotification("orderUpdates", "push")).toBe(false);
    at(8, 0);
    expect(prefs.shouldReceiveNotification("orderUpdates", "push")).toBe(true);
    at(12, 0);
    expect(prefs.shouldReceiveNotification("orderUpdates", "push")).toBe(true);
  });

  it("does not mute email during quiet hours", () => {
    const prefs = prefsWithQuietHours("22:00", "08:00");
    at(23, 30);
    expect(prefs.shouldReceiveNotification("orderUpdates", "email")).toBe(true);
  });

  it("honours a disabled toggle and a disabled channel", () => {
    const prefs = new NotificationPreferences({
      user: "64b000000000000000000001",
      pushNotifications: { promotions: false },
      emailNotifications: { enabled: false },
    });
    expect(prefs.shouldReceiveNotification("promotions", "push")).toBe(false);
    expect(prefs.shouldReceiveNotification("orderUpdates", "push")).toBe(true);
    expect(prefs.shouldReceiveNotification("orderUpdates", "email")).toBe(false);
  });
});
