const mongoose = require("mongoose"); // Erase if already required
const bcrypt = require("bcrypt");
const crypto = require("crypto");

// Declare the Schema of the Mongo model
var userSchema = new mongoose.Schema(
  {
    fullName: {
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
    
    password: {
      type: String,
      required: true,
    },
    address: {
      type: String,
    },
    residentialAddress: {
      type: String,
    },
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
      enum: ["active", "pending", "blocked"],
      default: "pending",
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
      relationship: {
        type: String,
        enum: ["spouse", "parent", "sibling", "child", "other"],
      },
      mobile: {
        type: String,
      },
      email: {
        type: String,
      },
      address: {
        type: String,
      },
    },
    modeOfTransport: {
      type: String,
      enum: ["bike", "motorcycle", "car", "van", "truck", "bicycle"],
    },
    balance: {
      type: Number,
      default: 0,
    },
    // FCM tokens for push notifications
    fcmTokens: [{
      token: {
        type: String,
        required: true
      },
      deviceType: {
        type: String,
        enum: ["android", "ios", "web"],
        required: true
      },
      deviceId: {
        type: String,
        required: true
      },
      lastUsed: {
        type: Date,
        default: Date.now
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }],
    passwordChangedAt: Date,
    passwordRefreshToken: String,
    passwordResetExpiresAt: Date,
  },
  {
    timestamps: true,
  }
);

userSchema.pre(`save`, async function (next) {
  const salt = await bcrypt.genSaltSync(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.isPasswordMatched = async function (enteredPassword) {
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
module.exports = mongoose.model("User", userSchema);
