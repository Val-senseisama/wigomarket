/**
 * Shop preferences: opening hours, visibility and fulfilment options.
 *
 * Opening hours are display-only (orders are accepted at any time); fulfilment
 * options are enforced at checkout; visibility is enforced on every public
 * read (utils/storeVisibility).
 */
const Validate = require("../Helpers/Validate");
const { WORKING_DAYS } = require("./workingDays");
const { DeliveryMethod } = require("./constants");

const DEFAULT_TIMEZONE = "Africa/Lagos";
const FULFILMENT_OPTIONS = ["delivery", "pickup"];

// Store fulfilment option ↔ order deliveryMethod.
const FULFILMENT_FOR_DELIVERY_METHOD = {
  [DeliveryMethod.DELIVERY_AGENT]: "delivery",
  [DeliveryMethod.SELF_DELIVERY]: "pickup",
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const isValidTimezone = (tz) => {
  if (!Validate.string(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Validate an openingHours body: `{ timezone?, days: [{ day, isOpen, open, close }] }`.
 * Days not listed are closed. Each day may appear once.
 * @returns {{ value: Object } | { error: string }}
 */
function parseOpeningHours(input) {
  if (!isPlainObject(input)) return { error: "openingHours must be an object" };

  const timezone = input.timezone === undefined ? DEFAULT_TIMEZONE : input.timezone;
  if (!isValidTimezone(timezone)) {
    return { error: "openingHours.timezone must be a valid IANA timezone (e.g. Africa/Lagos)" };
  }

  if (!Array.isArray(input.days)) return { error: "openingHours.days must be an array" };

  const seen = new Set();
  const days = [];
  for (const entry of input.days) {
    if (!isPlainObject(entry)) return { error: "Each openingHours.days entry must be an object" };
    const day = typeof entry.day === "string" ? entry.day.trim().toLowerCase() : "";
    if (!WORKING_DAYS.includes(day)) {
      return { error: `"${entry.day}" is not a valid day. Valid days: ${WORKING_DAYS.join(", ")}` };
    }
    if (seen.has(day)) return { error: `${day} is listed more than once` };
    seen.add(day);

    const isOpen = entry.isOpen === undefined ? true : entry.isOpen;
    if (typeof isOpen !== "boolean") return { error: `${day}.isOpen must be true or false` };

    if (!isOpen) {
      days.push({ day, isOpen: false });
      continue;
    }
    if (!Validate.time(entry.open) || !Validate.time(entry.close)) {
      return { error: `${day} needs open and close times in 24-hour HH:mm format` };
    }
    if (entry.open === entry.close) {
      return { error: `${day} open and close times must differ` };
    }
    days.push({ day, isOpen: true, open: entry.open, close: entry.close });
  }

  // Store in calendar order whatever order the client sent.
  days.sort((a, b) => WORKING_DAYS.indexOf(a.day) - WORKING_DAYS.indexOf(b.day));
  return { value: { timezone, days } };
}

/**
 * @returns {{ value: string[] } | { error: string }}
 */
function parseFulfilmentOptions(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { error: `fulfilmentOptions must be a non-empty array of: ${FULFILMENT_OPTIONS.join(", ")}` };
  }
  const value = [];
  for (const raw of input) {
    const opt = typeof raw === "string" ? raw.trim().toLowerCase() : raw;
    if (!FULFILMENT_OPTIONS.includes(opt)) {
      return { error: `"${raw}" is not a fulfilment option. Valid: ${FULFILMENT_OPTIONS.join(", ")}` };
    }
    if (!value.includes(opt)) value.push(opt);
  }
  return { value };
}

/** Weekday name and minutes-since-midnight for `now` in `timezone`. */
function localDayAndMinutes(now, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    day: get("weekday").toLowerCase(),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/**
 * Whether the shop is open at `now` by its own hours. null when the seller has
 * not set hours. A day whose close is earlier than its open runs past midnight
 * into the next day.
 */
function isOpenNow(openingHours, now = new Date()) {
  const days = openingHours?.days;
  if (!Array.isArray(days) || days.length === 0) return null;

  const timezone = isValidTimezone(openingHours.timezone) ? openingHours.timezone : DEFAULT_TIMEZONE;
  const { day, minutes } = localDayAndMinutes(now, timezone);
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));

  const today = byDay[day];
  if (today?.isOpen) {
    const open = toMinutes(today.open);
    const close = toMinutes(today.close);
    if (close > open ? minutes >= open && minutes < close : minutes >= open) return true;
  }

  // Yesterday's overnight hours spilling into today.
  const yesterday = byDay[WORKING_DAYS[(WORKING_DAYS.indexOf(day) + 6) % 7]];
  if (yesterday?.isOpen) {
    const open = toMinutes(yesterday.open);
    const close = toMinutes(yesterday.close);
    if (close < open && minutes < close) return true;
  }

  return false;
}

const plain = (store) => (store && typeof store.toObject === "function" ? store.toObject() : store || {});

/** The seller's settings view (GET/PUT /api/store/settings). */
function serializeStoreSettings(store, now = new Date()) {
  const s = plain(store);
  return {
    isVisible: s.isVisible !== false,
    openingHours: s.openingHours?.days?.length
      ? { timezone: s.openingHours.timezone || DEFAULT_TIMEZONE, days: s.openingHours.days }
      : null,
    isOpenNow: isOpenNow(s.openingHours, now),
    fulfilmentOptions: s.fulfilmentOptions?.length ? s.fulfilmentOptions : [...FULFILMENT_OPTIONS],
  };
}

// Owner-only fields that must never reach a buyer or guest.
const PRIVATE_STORE_FIELDS = [
  "ownerNIN",
  "bankDetails",
  "subAccountDetails",
  "balance",
  "history",
  "__v",
];

/** A store as buyers and guests see it (GET /api/store/:id). */
function serializePublicStore(store, now = new Date()) {
  const s = { ...plain(store) };
  for (const field of PRIVATE_STORE_FIELDS) delete s[field];
  const settings = serializeStoreSettings(store, now);
  return {
    ...s,
    openingHours: settings.openingHours,
    isOpenNow: settings.isOpenNow,
    fulfilmentOptions: settings.fulfilmentOptions,
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  FULFILMENT_OPTIONS,
  FULFILMENT_FOR_DELIVERY_METHOD,
  parseOpeningHours,
  parseFulfilmentOptions,
  isOpenNow,
  serializeStoreSettings,
  serializePublicStore,
};
