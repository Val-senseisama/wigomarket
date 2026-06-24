const Counter = require("../models/counterModel");

// First order number is BASE + 1 (e.g. WM1201). Keeps numbers short and
// recognisable in the dashboard while still being strictly increasing.
const ORDER_NUMBER_BASE = 1200;
const ORDER_NUMBER_PREFIX = "WM";

/**
 * Atomically generates the next sequential order number, e.g. "WM1201".
 *
 * Pass the active Mongoose session when called inside a transaction so the
 * counter increment rolls back with the order if the transaction aborts
 * (avoids burning a number on a failed order).
 *
 * @param {import("mongoose").ClientSession} [session]
 * @returns {Promise<string>} The generated order number (without the leading #).
 */
const generateOrderNumber = async (session) => {
  const counter = await Counter.findByIdAndUpdate(
    "order",
    { $inc: { seq: 1 } },
    { new: true, upsert: true, ...(session ? { session } : {}) },
  );

  return `${ORDER_NUMBER_PREFIX}${ORDER_NUMBER_BASE + counter.seq}`;
};

module.exports = { generateOrderNumber, ORDER_NUMBER_PREFIX, ORDER_NUMBER_BASE };
