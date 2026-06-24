/**
 * @file vehicleType.js
 * @description Shared helpers for normalising dispatch vehicle types. The UI
 *   offers: feet, bicycle, car, motor bike, bus. These are mapped onto the
 *   canonical values stored in the DispatchProfile schema enum.
 */

// Vehicle types offered in the UI (what clients should send).
const UI_VEHICLE_TYPES = ["feet", "bicycle", "car", "motor bike", "bus"];

// Types with no make/model/plate/colour — only the type itself is stored.
const NON_MOTORISED_TYPES = new Set(["feet", "bicycle"]);

// Map UI labels / common variants onto the canonical schema enum value.
const VEHICLE_TYPE_ALIASES = {
  feet: "feet",
  foot: "feet",
  walking: "feet",
  "on foot": "feet",
  bicycle: "bicycle",
  car: "car",
  bus: "bus",
  "motor bike": "motorcycle",
  motorbike: "motorcycle",
  motorcycle: "motorcycle",
  bike: "motorcycle",
  van: "van",
  truck: "truck",
};

/**
 * Normalise a user-supplied vehicle type to the canonical schema enum value.
 * Returns null when the value isn't recognised.
 * @param {string} raw
 * @returns {string|null}
 */
function normalizeVehicleType(raw) {
  if (raw === undefined || raw === null) return null;
  const key = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  return VEHICLE_TYPE_ALIASES[key] || null;
}

/**
 * @param {string} canonicalType - already-normalised type
 * @returns {boolean} whether the type requires make/model/plate/colour
 */
function isMotorisedType(canonicalType) {
  return !NON_MOTORISED_TYPES.has(canonicalType);
}

module.exports = {
  UI_VEHICLE_TYPES,
  NON_MOTORISED_TYPES,
  normalizeVehicleType,
  isMotorisedType,
};
