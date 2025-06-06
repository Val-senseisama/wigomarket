const mongoose = require("mongoose"); // Erase if already required
const bcrypt = require("bcrypt");
const crypto = require("crypto");

// Declare the Schema of the Mongo model
var userSchema = new mongoose.Schema(
  {
    firstname: {
      type: String,
      required: true,
    },
    lastname: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
    },
    role: {
      type: [String], // Array of strings
      enum: ["seller", "buyer", "dispatch", "admin"], // Valid roles
      default: ["buyer"], // Default role is 'buyer'
    },
    
    password: {
      type: String,
      required: true,
    },
    address: {
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
    balance: {
      type: Number,
      default: 0,
    },
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
