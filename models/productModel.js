const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
    },
    description: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true,
    },
    listedPrice: {
      type: Number,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    brand: {
      type: String,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    images: {
      type: Array,
    },
    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },
    views: {
      type: Number,
      default: 0,
    },
    sold: {
      type: Number,
      default: 0,
      min: 0,
    },
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      count: {
        type: Number,
        default: 0,
      },
    },
    tags: [String],
    isFeatured: {
      type: Boolean,
      default: false,
    },

    // Structured key/value attributes — e.g. { key: "RAM", value: "8 GB" }
    specifications: [
      {
        key:   { type: String, trim: true },
        value: { type: String, trim: true },
      },
    ],

    // Available size options — e.g. ["S","M","L"] or ["40","41","42"]
    sizes: {
      type: [String],
      default: [],
    },

    // Available colour options — name is required, hex is optional
    colors: [
      {
        name: { type: String, trim: true, required: true },
        hex:  { type: String, trim: true, default: null },
      },
    ],
  },
  {
    timestamps: true,
  }
);

//Export the model
module.exports = mongoose.model("Product", productSchema);
