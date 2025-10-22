const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var commissionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    description: {
      type: String,
    },
    type: {
      type: String,
      enum: ["platform", "dispatch", "seller", "referral"],
      required: true,
    },
    role: {
      type: String,
      enum: ["buyer", "seller", "dispatch", "admin"],
      required: true,
    },
    calculationMethod: {
      type: String,
      enum: ["percentage", "fixed", "tiered"],
      required: true,
    },
    rates: {
      // For percentage-based commissions
      percentage: {
        type: Number,
        min: 0,
        max: 100,
      },
      // For fixed amount commissions
      fixedAmount: {
        type: Number,
        min: 0,
      },
      // For tiered commissions
      tiers: [
        {
          minAmount: {
            type: Number,
            required: true,
          },
          maxAmount: {
            type: Number,
          },
          percentage: {
            type: Number,
            required: true,
            min: 0,
            max: 100,
          },
          fixedAmount: {
            type: Number,
            min: 0,
          },
        },
      ],
    },
    conditions: {
      minOrderValue: {
        type: Number,
        default: 0,
      },
      maxOrderValue: {
        type: Number,
      },
      applicableCategories: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Category",
        },
      ],
      applicableStores: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Store",
        },
      ],
      deliveryMethod: {
        type: String,
        enum: ["pickup", "dispatch", "both"],
        default: "both",
      },
      distanceBased: {
        enabled: {
          type: Boolean,
          default: false,
        },
        baseDistance: {
          type: Number, // in kilometers
          default: 5,
        },
        additionalRate: {
          type: Number, // per additional kilometer
          default: 0,
        },
      },
    },
    status: {
      type: String,
      enum: ["active", "inactive", "archived"],
      default: "active",
    },
    effectiveFrom: {
      type: Date,
      default: Date.now,
    },
    effectiveTo: {
      type: Date,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    priority: {
      type: Number,
      default: 0, // Higher number = higher priority
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
commissionSchema.index({ type: 1, role: 1, status: 1 });
commissionSchema.index({ "conditions.applicableCategories": 1 });
commissionSchema.index({ "conditions.applicableStores": 1 });
commissionSchema.index({ effectiveFrom: 1, effectiveTo: 1 });
commissionSchema.index({ priority: -1 });

// Virtual for checking if commission is currently effective
commissionSchema.virtual("isEffective").get(function () {
  const now = new Date();
  return (
    this.status === "active" &&
    this.effectiveFrom <= now &&
    (!this.effectiveTo || this.effectiveTo >= now)
  );
});

// Method to calculate commission for an order
commissionSchema.methods.calculateCommission = function (orderValue, additionalData = {}) {
  if (!this.isEffective) {
    return 0;
  }

  // Check minimum order value condition
  if (this.conditions.minOrderValue && orderValue < this.conditions.minOrderValue) {
    return 0;
  }

  // Check maximum order value condition
  if (this.conditions.maxOrderValue && orderValue > this.conditions.maxOrderValue) {
    return 0;
  }

  let commission = 0;

  switch (this.calculationMethod) {
    case "percentage":
      commission = (orderValue * this.rates.percentage) / 100;
      break;

    case "fixed":
      commission = this.rates.fixedAmount;
      break;

    case "tiered":
      for (const tier of this.rates.tiers) {
        if (
          orderValue >= tier.minAmount &&
          (!tier.maxAmount || orderValue <= tier.maxAmount)
        ) {
          if (tier.percentage) {
            commission = (orderValue * tier.percentage) / 100;
          } else if (tier.fixedAmount) {
            commission = tier.fixedAmount;
          }
          break;
        }
      }
      break;
  }

  // Apply distance-based adjustments for dispatch commissions
  if (this.type === "dispatch" && this.conditions.distanceBased.enabled) {
    const distance = additionalData.distance || 0;
    if (distance > this.conditions.distanceBased.baseDistance) {
      const additionalDistance = distance - this.conditions.distanceBased.baseDistance;
      commission += additionalDistance * this.conditions.distanceBased.additionalRate;
    }
  }

  return Math.round(commission * 100) / 100; // Round to 2 decimal places
};

//Export the model
module.exports = mongoose.model("Commission", commissionSchema);
