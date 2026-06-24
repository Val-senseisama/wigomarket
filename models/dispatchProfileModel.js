const mongoose = require("mongoose");

var dispatchProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    vehicleInfo: {
      type: {
        type: String,
        enum: ["bike", "motorcycle", "car", "van", "truck", "bicycle", "feet", "bus"],
        required: true,
      },
      // make/model/year/plateNumber/color only apply to motorised vehicles.
      // Non-motorised agents (feet, bicycle) leave these blank — the controller
      // enforces them per vehicle type. plateNumber stays unique but sparse so
      // multiple plate-less agents don't collide on a null value.
      make:        { type: String },
      model:       { type: String },
      year:        { type: Number },
      plateNumber: { type: String, unique: true, sparse: true },
      color:       { type: String },
    },

    coverageAreas: [
      {
        name:        { type: String, required: true },
        coordinates: {
          latitude:  { type: Number, required: true },
          longitude: { type: Number, required: true },
        },
        radius: { type: Number, default: 5 }, // km
      },
    ],

    availability: {
      status: {
        type: String,
        enum: ["online", "offline", "busy", "unavailable"],
        default: "offline",
      },
      workingDays: {
        type: [String],
        enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
        default: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
    },

    // ── Documents — NOT required at schema level so agents can create the
    //   profile first and upload documents in a separate step.
    //   `setupLevel` virtual tracks completion.
    documents: {
      driverLicense: {
        number:     { type: String, default: null },
        expiryDate: { type: Date,   default: null },
        image:      { type: String, default: null }, // Cloudinary URL
        verified:   { type: Boolean, default: false },
      },
      vehicleRegistration: {
        number:     { type: String, default: null },
        expiryDate: { type: Date,   default: null },
        image:      { type: String, default: null },
        verified:   { type: Boolean, default: false },
      },
      nin: {
        number:   { type: String, default: null },
        image:    { type: String, default: null },
        verified: { type: Boolean, default: false },
      },
    },

    // ── Payment information for delivery fee payouts ─────────────────────────
    // Bank picker on mobile returns bankCode alongside bankName; agents never
    // type it manually. accountName should be confirmed via a name-inquiry API
    // before saving (handled by the controller).
    paymentInfo: {
      accountName:   { type: String, default: null },
      accountNumber: { type: String, default: null }, // 10-digit NUBAN
      bankName:      { type: String, default: null },
      bankCode:      { type: String, default: null }, // 3-char Flutterwave code
    },

    rating: {
      average:      { type: Number, default: 0, min: 0, max: 5 },
      totalReviews: { type: Number, default: 0 },
      breakdown: {
        punctuality:     { type: Number, default: 0, min: 0, max: 5 },
        communication:   { type: Number, default: 0, min: 0, max: 5 },
        handling:        { type: Number, default: 0, min: 0, max: 5 },
        professionalism: { type: Number, default: 0, min: 0, max: 5 },
      },
    },

    earnings: {
      totalEarnings:       { type: Number, default: 0 },
      totalDeliveries:     { type: Number, default: 0 },
      averageDeliveryTime: { type: Number, default: 0 }, // minutes
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    isActive:     { type: Boolean, default: false },
    lastActiveAt: { type: Date },
  },
  { timestamps: true },
);

// ── Virtuals ──────────────────────────────────────────────────────────────────
dispatchProfileSchema.set("toJSON",   { virtuals: true });
dispatchProfileSchema.set("toObject", { virtuals: true });

/**
 * setupLevel — tracks how far through the onboarding flow an agent is.
 *   1  Profile created (vehicle info present)
 *   2  Documents uploaded (all 3 images present)
 *   3  Payment info added (accountNumber present) — ready for admin review
 */
dispatchProfileSchema.virtual("setupLevel").get(function () {
  const docs = this.documents;
  const docsComplete =
    !!(docs?.driverLicense?.image &&
       docs?.vehicleRegistration?.image &&
       docs?.nin?.image);

  const paymentComplete = !!this.paymentInfo?.accountNumber;

  if (docsComplete && paymentComplete) return 3;
  if (docsComplete)                    return 2;
  return 1;
});

/**
 * setupSteps — checklist for the mobile onboarding screen.
 */
dispatchProfileSchema.virtual("setupSteps").get(function () {
  const docs = this.documents;
  return {
    profile: {
      complete: true,
      label: "Basic profile & vehicle information",
    },
    documents: {
      complete: !!(
        docs?.driverLicense?.image &&
        docs?.vehicleRegistration?.image &&
        docs?.nin?.image
      ),
      label: "Upload vehicle & identity documents",
    },
    payment: {
      complete: !!this.paymentInfo?.accountNumber,
      label: "Add payment / bank account details",
    },
  };
});

// ── Indexes ───────────────────────────────────────────────────────────────────
dispatchProfileSchema.index({ user: 1 });
dispatchProfileSchema.index({
  "coverageAreas.coordinates.latitude": 1,
  "coverageAreas.coordinates.longitude": 1,
});
dispatchProfileSchema.index({ "availability.status": 1, "availability.workingDays": 1 });
dispatchProfileSchema.index({ status: 1, isActive: 1 });

module.exports = mongoose.model("DispatchProfile", dispatchProfileSchema);
