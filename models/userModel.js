const mongoose = require("mongoose"); // Erase if already required
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { normalizeVehicleType } = require("../utils/vehicleType");

// Credentials and one-time secrets: never part of any response. Applies to
// res.json(userDoc) and populated users. `.lean()` queries skip transforms, so
// those must `.select(User.SECRET_FIELDS_EXCLUSION)` instead.
const SECRET_FIELDS = [
  "password",
  "refreshToken",
  "passwordRefreshToken",
  "passwordResetToken",
  "passwordResetExpires",
  "passwordResetExpiresAt",
];

function stripSecrets(doc, ret) {
  for (const field of SECRET_FIELDS) delete ret[field];
  return ret;
}

// Declare the Schema of the Mongo model
var userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
    },
    firstname: {
      type: String,
    },
    lastname: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    mobile: {
      type: String,
      required: false, // Made optional for Google auth users
      unique: true,
      sparse: true, // Allows multiple null values
    },
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true, // Allows multiple null values
    },
    role: {
      type: [String], // Array of strings
      enum: ["seller", "buyer", "dispatch", "admin"], // Valid roles
      default: ["buyer"], // Default role is 'buyer'
    },
    activeRole: {
      type: String,
      enum: ["seller", "buyer", "dispatch", "admin"],
      default: "buyer", // Default active role
    },

    // Google sign-in accounts have no password (controllers/user/googleAuth).
    password: {
      type: String,
      required: function () {
        return !this.firebaseUid;
      },
    },
    address: {
      type: String,
    },
    residentialAddress: {
      type: String,
    },
    // Saved delivery addresses with map coordinates
    savedAddresses: [
      {
        label: {
          type: String,
          default: "Home", // 'Home', 'Office', etc.
        },
        formattedAddress: {
          type: String,
          required: true,
        },
        location: {
          type: {
            type: String,
            enum: ["Point"],
            default: "Point",
          },
          coordinates: {
            type: [Number], // [longitude, latitude]
          },
        },
        isDefault: {
          type: Boolean,
          default: false,
        },
      },
    ],
    city: {
      type: String,
    },
    state: {
      type: String,
    },
    image: {
      type: String,
    },
    status: {
      type: String,
      enum: ["active", "pending", "blocked", "deleted"],
      default: "pending",
    },
    // Set when the user deletes their own account (DELETE /api/user/me). The
    // row is kept, anonymised, so orders and ledger entries still resolve.
    deletedAt: {
      type: Date,
    },
    // A requested email change awaiting its OTP (POST /api/user/verify-email-change).
    // `email` keeps the verified address until then.
    pendingEmail: {
      type: String,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    cart: {
      type: Array,
      default: [],
    },
    refreshToken: {
      type: String,
    },
    nickname: {
      type: String,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other"],
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    dispatchProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DispatchProfile",
    },
    // Delivery agent specific fields
    nextOfKin: {
      name: {
        type: String,
      },

      mobile: {
        type: String,
      },
    },
    modeOfTransport: {
      type: String,
      enum: [
        "bike",
        "motorcycle",
        "car",
        "van",
        "truck",
        "bicycle",
        "feet",
        "bus",
      ],
      // Accept UI labels ("motor bike") and store the canonical value.
      set: (v) => normalizeVehicleType(v) || v,
    },
    // FCM tokens for push notifications
    fcmTokens: [
      {
        token: {
          type: String,
          required: true,
        },
        deviceType: {
          type: String,
          enum: ["android", "ios", "web"],
          required: true,
        },
        deviceId: {
          type: String,
          required: true,
        },
        lastUsed: {
          type: Date,
          default: Date.now,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],
    passwordChangedAt: Date,
    passwordRefreshToken: String,
    passwordResetExpiresAt: Date,
  },
  {
    timestamps: true,
    toJSON: { transform: stripSecrets },
    toObject: { transform: stripSecrets },
  },
);

// Hash only when the password itself was set or changed. Any other save()
// (FCM token registration, Google account linking...) used to hash the stored
// hash again, so the user's real password stopped working.
userSchema.pre(`save`, async function () {
  if (!this.isModified("password") || !this.password) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.isPasswordMatched = async function (enteredPassword) {
  if (!this.password || typeof enteredPassword !== "string") return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.createPasswordResetToken = async function () {
  const resetToken = crypto.randomBytes(32).toString("hex");
  this.passwordResetToken = crypto
    .createHash("sha256")
    .update(resetToken)
    .digest("hex");
  this.passwordResetExpires = Date.now() + 30 * 60 * 1000; // 10 mins
  return resetToken;
};
//Export the model
const User = mongoose.model("User", userSchema);
User.SECRET_FIELDS = SECRET_FIELDS;
User.SECRET_FIELDS_EXCLUSION = SECRET_FIELDS.map((f) => `-${f}`).join(" ");
module.exports = User;
