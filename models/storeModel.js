const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    image: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    address: {
      type: String,
    },
    // GeoJSON location for map display & geospatial queries
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: undefined,
      },
      formattedAddress: {
        type: String,
      },
    },
    businessType: {
      type: String,
      required: true,
      index: true,
    },
    city: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    ownerNIN: {
      type: String, // URL/Ref to image
      required: true,
    },
    description: {
      type: String,
    },
    status: {
      type: String,
      enum: ["pending", "active", "suspended"],
      default: "pending",
    },
    balance: {
      type: Number,
      default: 0,
    },
    history: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        count: Number,
        profit: Number,
        created: Date,
      },
    ],
    bankDetails: {
      accountName: {
        type: String,
      },
      bankCode: {
        type: Number,
        length: 3,
      },
      bankName: {
        type: String,
      },
      accountNumber: {
        type: Number,
        length: 10,
      },
    },
    subAccountDetails: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

// Geospatial index for nearby store queries
storeSchema.index({ location: "2dsphere" });

//Export the model
module.exports = mongoose.model("Store", storeSchema);
