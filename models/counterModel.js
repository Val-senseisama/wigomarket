const mongoose = require("mongoose");

/**
 * Generic atomic counter used to generate human-friendly sequential IDs
 * (e.g. order numbers). Each document represents one named sequence.
 *
 * Increment atomically with `findByIdAndUpdate(name, { $inc: { seq: 1 } },
 * { new: true, upsert: true })` so concurrent requests never collide.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // sequence name, e.g. "order"
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);
