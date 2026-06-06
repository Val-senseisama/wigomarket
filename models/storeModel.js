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
    // GeoJSON location for map display & geospatial queries.
    // NOTE: do not default `type` to "Point" — Mongoose would then persist
    // `location: { type: "Point" }` with no coordinates for stores created
    // without a geocoded address, producing invalid GeoJSON that makes the
    // 2dsphere index throw "Can't extract geo keys". The whole `location`
    // object must be omitted (or carry valid coordinates) instead.
    location: {
      type: {
        type: String,
        enum: ["Point"],
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
    // Denormalised rating cache — recomputed from product ratings via syncStoreRating()
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count:   { type: Number, default: 0, min: 0 },
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
