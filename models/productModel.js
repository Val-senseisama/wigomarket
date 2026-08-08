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
    // Seller-facing unit code from the "Stock Keeping Unit (SKU)" field.
    // Optional, but must be unique within a store when given — see the partial
    // index at the bottom of this file.
    sku: {
      type: String,
      trim: true,
    },
    // "single"   — one version, priced and stocked by the fields below.
    // "variable" — several versions; see optionTypes/variants. For a variable
    //              product `price`/`listedPrice`/`quantity` are DERIVED, never
    //              set directly: price is the cheapest variant (the "from ₦X"
    //              figure) and quantity is the total across variants. Keeping
    //              them populated is what lets search, sorting, cart and the
    //              order pipeline treat both product types identically.
    productType: {
      type: String,
      enum: ["single", "variable"],
      default: "single",
      index: true,
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
    // Cloudinary URLs, 1-5. images[0] is the main/display image on the
    // storefront; the rest are extra angles.
    images: {
      type: Array,
    },
    // Optional short product video (Cloudinary URL). The 60s / 20MB / MP4 limits
    // from the upload screen are enforced at upload time by Cloudinary, not here.
    video: {
      type: String,
      default: null,
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

    // ── Multiple-version products ───────────────────────────────────────────
    // The axes a variable product varies along. Empty for a single product.
    //   [{ name: "Size", values: ["40","41","42"] }, { name: "Color", ... }]
    optionTypes: [
      {
        name:   { type: String, trim: true, required: true },
        values: { type: [String], default: [] },
        _id: false,
      },
    ],

    // One entry per version actually for sale. A seller need not list every
    // combination of optionTypes — only the ones they stock. Validation lives in
    // utils/productVariants.
    variants: [
      {
        sku:         { type: String, trim: true },
        price:       { type: Number, required: true },
        listedPrice: { type: Number },
        quantity:    { type: Number, required: true, min: 0 },
        sold:        { type: Number, default: 0, min: 0 },
        image:       { type: String, default: null },
        // Pins this variant to one value per option type.
        options: [
          {
            name:  { type: String, trim: true, required: true },
            value: { type: String, trim: true, required: true },
            _id: false,
          },
        ],
      },
    ],
  },
  {
    timestamps: true,
  }
);

// SKUs identify a product within its own store, so they are unique per store
// rather than globally — two sellers may both use "SPK-001". Partial so the many
// products without a SKU do not collide on null.
productSchema.index(
  { store: 1, sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: "string" } } },
);

//Export the model
module.exports = mongoose.model("Product", productSchema);
