/**
 * Order status state machine.
 *
 * `orderStatus` on the Order model is the single canonical lifecycle field.
 * This module is the source of truth for:
 *   - the set of valid states and their human labels,
 *   - which transitions are allowed and which role owns each one,
 *   - normalisation of legacy status values,
 *   - the category groupings the dashboard filters on.
 *
 * All lifecycle mutations must go through services/orderTransitionService so the
 * rules below are enforced in exactly one place.
 *
 * Flow:
 *   pending ─► confirmed ─► preparing ─► pickUpReady ─► inTransit ─► delivered
 *      │           │            │             │
 *      └───────────┴────────────┴─────────────┴────────────────► cancelled
 *
 *   Ownership:
 *     seller : pending → confirmed → preparing → pickUpReady
 *              (+ pickUpReady → delivered for self_delivery / pickup orders)
 *     rider  : pickUpReady → inTransit → delivered (delivery_agent orders)
 *     admin  : may perform any transition (override)
 *     system : automated transitions (e.g. dual-confirm delivery credit)
 */

const STATUS = {
  PENDING: "pending",
  CONFIRMED: "confirmed",
  PREPARING: "preparing",
  PICKUP_READY: "pickUpReady",
  IN_TRANSIT: "inTransit",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
};

const STATUS_LABELS = {
  [STATUS.PENDING]: "Pending",
  [STATUS.CONFIRMED]: "Confirmed",
  [STATUS.PREPARING]: "Preparing",
  [STATUS.PICKUP_READY]: "Pick up Ready",
  [STATUS.IN_TRANSIT]: "In Transit",
  [STATUS.DELIVERED]: "Delivered",
  [STATUS.CANCELLED]: "Cancelled",
};

const ROLE = {
  SELLER: "seller",
  RIDER: "rider",
  ADMIN: "admin",
  SYSTEM: "system",
};

const ALL_STATUSES = Object.values(STATUS);
const TERMINAL_STATUSES = [STATUS.DELIVERED, STATUS.CANCELLED];
// Non-terminal states — an order in any of these is still "in progress".
const ACTIVE_STATUSES = ALL_STATUSES.filter((s) => !TERMINAL_STATUSES.includes(s));

/**
 * Transition table. Each entry: { from, to, roles, deliveryMethod? }.
 * `deliveryMethod` (optional) restricts the transition to orders of that method.
 * Admin is added to every transition's role set automatically (override power).
 */
const TRANSITIONS = [
  { from: STATUS.PENDING, to: STATUS.CONFIRMED, roles: [ROLE.SELLER] },
  { from: STATUS.CONFIRMED, to: STATUS.PREPARING, roles: [ROLE.SELLER] },
  { from: STATUS.PREPARING, to: STATUS.PICKUP_READY, roles: [ROLE.SELLER] },

  // Rider leg (delivery_agent orders).
  { from: STATUS.PICKUP_READY, to: STATUS.IN_TRANSIT, roles: [ROLE.RIDER], deliveryMethod: "delivery_agent" },
  // delivery_agent "delivered" is reached only via the dual-confirm flow
  // (agent + customer), which runs as SYSTEM. A rider cannot set it directly.
  { from: STATUS.IN_TRANSIT, to: STATUS.DELIVERED, roles: [ROLE.SYSTEM], deliveryMethod: "delivery_agent" },

  // Pickup orders have no rider — the seller hands off to the customer.
  { from: STATUS.PICKUP_READY, to: STATUS.DELIVERED, roles: [ROLE.SELLER, ROLE.SYSTEM], deliveryMethod: "self_delivery" },

  // Cancellation — allowed from any pre-delivery (non-terminal, pre-transit) state.
  { from: STATUS.PENDING, to: STATUS.CANCELLED, roles: [ROLE.SELLER] },
  { from: STATUS.CONFIRMED, to: STATUS.CANCELLED, roles: [ROLE.SELLER] },
  { from: STATUS.PREPARING, to: STATUS.CANCELLED, roles: [ROLE.SELLER] },
  { from: STATUS.PICKUP_READY, to: STATUS.CANCELLED, roles: [ROLE.SELLER] },
];

// Map legacy / pre-state-machine values onto canonical states so old orders and
// any stray writers still resolve to a valid state.
const LEGACY_MAP = {
  "Not yet processed": STATUS.PENDING,
  Pending: STATUS.PENDING,
  Processing: STATUS.PREPARING,
  Dispatched: STATUS.IN_TRANSIT,
  Delivered: STATUS.DELIVERED,
  Cancelled: STATUS.CANCELLED,
};

/** Coerce any stored/legacy status value into a canonical state token. */
const normalizeStatus = (value) => {
  if (!value) return STATUS.PENDING;
  if (ALL_STATUSES.includes(value)) return value;
  return LEGACY_MAP[value] || STATUS.PENDING;
};

const statusLabel = (value) => STATUS_LABELS[normalizeStatus(value)] || "Pending";

const isTerminal = (value) => TERMINAL_STATUSES.includes(normalizeStatus(value));

const isValidStatus = (value) => ALL_STATUSES.includes(value);

/** Does this role (admin overrides) have a transition from→to for the given delivery method? */
const findTransition = (from, to, role, deliveryMethod) =>
  TRANSITIONS.find(
    (t) =>
      t.from === from &&
      t.to === to &&
      (role === ROLE.ADMIN || t.roles.includes(role)) &&
      (!t.deliveryMethod || !deliveryMethod || t.deliveryMethod === deliveryMethod),
  );

const canTransition = (from, to, role, deliveryMethod) =>
  Boolean(findTransition(normalizeStatus(from), to, role, deliveryMethod));

/** Target states a given role may move an order to from its current state. */
const allowedTransitions = (from, role, deliveryMethod) => {
  const current = normalizeStatus(from);
  return TRANSITIONS.filter(
    (t) =>
      t.from === current &&
      (role === ROLE.ADMIN || t.roles.includes(role)) &&
      (!t.deliveryMethod || !deliveryMethod || t.deliveryMethod === deliveryMethod),
  ).map((t) => t.to);
};

// ── Dashboard category groupings ──────────────────────────────────────────────
const CATEGORY = {
  ALL: "all",
  PENDING: "pending",
  ONGOING: "ongoing",
  HISTORY: "history",
};

/** Mongo filter fragment for a dashboard category (operates on orderStatus). */
const categoryFilter = (category) => {
  switch (String(category || CATEGORY.ALL).toLowerCase()) {
    case CATEGORY.PENDING:
      return { orderStatus: STATUS.PENDING };
    case CATEGORY.ONGOING:
      return { orderStatus: { $in: ACTIVE_STATUSES } };
    case CATEGORY.HISTORY:
      return { orderStatus: { $in: TERMINAL_STATUSES } };
    case CATEGORY.ALL:
    case "recent": // backwards-compatible alias
    default:
      return {};
  }
};

module.exports = {
  STATUS,
  STATUS_LABELS,
  ROLE,
  TRANSITIONS,
  ALL_STATUSES,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  normalizeStatus,
  statusLabel,
  isTerminal,
  isValidStatus,
  canTransition,
  allowedTransitions,
  findTransition,
  CATEGORY,
  categoryFilter,
};
