const NotificationPreferences = require("../models/notificationPreferencesModel");
const Validate = require("../Helpers/Validate");

// Schema paths a user may never write through the preferences endpoint.
const PROTECTED_PATHS = new Set([
  "_id",
  "__v",
  "user",
  "lastUpdated",
  "createdAt",
  "updatedAt",
]);

// Every user-editable leaf path, derived from the schema so a new toggle added
// to the model is editable (and validated) without touching this file.
function editablePaths() {
  const paths = {};
  NotificationPreferences.schema.eachPath((path, schemaType) => {
    if (PROTECTED_PATHS.has(path)) return;
    paths[path] = schemaType;
  });
  return paths;
}

function isValidTimezone(tz) {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Turn a (possibly partial, nested) preferences body into a flat `$set` of dot
 * paths, so `{ pushNotifications: { promotions: false } }` flips that one
 * toggle without resetting its siblings. Unknown keys are rejected rather than
 * ignored — a typo'd toggle that "saves" but never sticks is worse than a 400.
 *
 * @param {Object} body
 * @returns {{ updates: Object } | { error: string }}
 */
function buildPreferenceUpdate(body) {
  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    return { error: "Request body must contain at least one preference to update" };
  }

  const paths = editablePaths();
  const updates = {};

  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const schemaType = paths[path];

      if (!schemaType) {
        // A group such as `pushNotifications` — recurse into it.
        const isGroup = Object.keys(paths).some((p) => p.startsWith(`${path}.`));
        if (isGroup) {
          if (!isPlainObject(value)) return `${path} must be an object`;
          const err = walk(value, path);
          if (err) return err;
          continue;
        }
        return `Unknown preference: ${path}`;
      }

      if (schemaType.instance === "Boolean") {
        if (typeof value !== "boolean") return `${path} must be true or false`;
      } else if (schemaType.instance === "String") {
        if (typeof value !== "string") return `${path} must be a string`;
        const allowed = schemaType.enumValues || [];
        if (allowed.length && !allowed.includes(value)) {
          return `${path} must be one of: ${allowed.join(", ")}`;
        }
        if (path === "quietHours.startTime" || path === "quietHours.endTime") {
          if (!Validate.time(value)) return `${path} must be in 24-hour HH:mm format`;
        }
        if (path === "quietHours.timezone" && !isValidTimezone(value)) {
          return `${path} must be a valid IANA timezone (e.g. Africa/Lagos)`;
        }
      }

      updates[path] = value;
    }
    return null;
  };

  const error = walk(body, "");
  if (error) return { error };
  return { updates };
}

/**
 * Client-facing shape of a preferences document: every group always present
 * with defaults filled in, and no internal fields.
 */
function serializePreferences(doc) {
  const source = doc && typeof doc.toObject === "function" ? doc.toObject() : doc || {};
  const defaults = new NotificationPreferences().toObject();
  const pick = (group) => ({ ...defaults[group], ...(source[group] || {}) });

  return {
    pushNotifications: pick("pushNotifications"),
    emailNotifications: pick("emailNotifications"),
    smsNotifications: pick("smsNotifications"),
    quietHours: pick("quietHours"),
    frequency: pick("frequency"),
    language: source.language ?? defaults.language,
    lastUpdated: source.lastUpdated ?? null,
  };
}

module.exports = { buildPreferenceUpdate, serializePreferences };
