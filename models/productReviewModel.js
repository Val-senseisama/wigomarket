const mongoose = require("mongoose");

/**
 * Product reviews — one per (user × product). A user can update their review
 * but cannot leave more than one per product.
 *
 * `isVerifiedPurchase` is set true when the user has a Delivered order that
 * contains this product; the controller enforces this before creating a review.
 *
 * The post-save hook recomputes `product.rating.average` and
 * `product.rating.count` so the denormalised cache stays accurate.
 */
const productReviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // The order that verified the purchase
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: true,
    },
    helpful: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "hidden", "reported"],
      default: "active",
      index: true,
    },
  },
  { timestamps: true },
);

// One review per user per product (upsert on create keeps this invariant)
productReviewSchema.index({ product: 1, user: 1 }, { unique: true });

// Efficient sorted fetch for the reviews endpoint
productReviewSchema.index({ product: 1, status: 1, createdAt: -1 });
productReviewSchema.index({ product: 1, status: 1, helpful: -1 });
productReviewSchema.index({ product: 1, status: 1, rating: -1 });
productReviewSchema.index({ product: 1, status: 1, rating: 1 });

// ── Post-save: recompute denormalised rating on product ────────────────────
async function recomputeProductRating(productId) {
  try {
    const stats = await mongoose.model("ProductReview").aggregate([
      { $match: { product: productId, status: "active" } },
      {
        $group: {
          _id: null,
          avg:   { $avg: "$rating" },
          count: { $sum: 1 },
        },
      },
    ]);

    await mongoose.model("Product").findByIdAndUpdate(productId, {
      "rating.average": stats.length > 0 ? Math.round(stats[0].avg * 10) / 10 : 0,
      "rating.count":   stats.length > 0 ? stats[0].count : 0,
    });
  } catch (err) {
    console.error("productReview: failed to recompute product rating:", err.message);
  }
}

productReviewSchema.post("save", async function () {
  await recomputeProductRating(this.product);
});

// Also recompute when a review is deleted or status changes to hidden/reported
productReviewSchema.post("findOneAndUpdate", async function (doc) {
  if (doc) await recomputeProductRating(doc.product);
});

productReviewSchema.post("findOneAndDelete", async function (doc) {
  if (doc) await recomputeProductRating(doc.product);
});

module.exports = mongoose.model("ProductReview", productReviewSchema);
