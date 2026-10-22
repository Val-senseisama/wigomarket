const mongoose = require("mongoose");

const STATUSES = ["open", "in_progress", "resolved"];

// A "Contact support" form submission. Stored so nothing is lost if the email
// to the support inbox fails, and so a team member can track it to resolution.
const supportRequestSchema = new mongoose.Schema(
  {
    // Short human-facing reference quoted back to the user, e.g. "SR-7K2Q9XHD".
    reference: { type: String, required: true, unique: true },
    firstName: { type: String, required: true, trim: true, maxlength: 50 },
    lastName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    // Set when the sender was signed in; guests can submit too.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    status: {
      type: String,
      enum: STATUSES,
      default: "open",
      index: true,
    },
    // The support team's reply, shown to the user and emailed to `email`.
    // A later reply replaces it.
    response: { type: String, trim: true, maxlength: 2000, default: null },
    respondedAt: { type: Date, default: null },
    respondedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

supportRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model("SupportRequest", supportRequestSchema);
module.exports.STATUSES = STATUSES;
