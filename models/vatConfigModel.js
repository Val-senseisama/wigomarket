const mongoose = require("mongoose");

// VAT configuration schema
const vatConfigSchema = new mongoose.Schema({
  // VAT rates
  rates: {
    standard: {
      type: Number,
      default: 7.5, // Nigerian standard VAT rate
      min: 0,
      max: 100
    },
    reduced: {
      type: Number,
      default: 0, // Reduced rate for certain goods
      min: 0,
      max: 100
    },
    zero: {
      type: Number,
      default: 0 // Zero-rated goods
    }
  },
  
  // VAT thresholds
  thresholds: {
    registration: {
      type: Number,
      default: 25000000 // 25M NGN annual turnover threshold
    },
    collection: {
      type: Number,
      default: 1000000 // 1M NGN minimum collection threshold
    }
  },
  
  // VAT responsibility rules
  responsibility: {
    platform: {
      // When platform is responsible for VAT
      conditions: [{
        type: String,
        enum: ["all_transactions", "above_threshold", "specific_categories"]
      }],
      categories: [String], // Product categories where platform handles VAT
      threshold: Number
    },
    vendor: {
      // When vendor is responsible for VAT
      conditions: [{
        type: String,
        enum: ["registered_vendor", "above_threshold", "specific_categories"]
      }],
      categories: [String],
      threshold: Number
    }
  },
  
  // Remittance settings
  remittance: {
    frequency: {
      type: String,
      enum: ["monthly", "quarterly", "annually"],
      default: "monthly"
    },
    dueDate: {
      type: Number,
      default: 21 // 21st of the month
    },
    minimumAmount: {
      type: Number,
      default: 100000 // 100K NGN minimum remittance
    }
  },
  
  // VAT categories and exemptions
  categories: [{
    name: {
      type: String,
      required: true
    },
    code: {
      type: String,
      required: true,
      unique: true
    },
    rate: {
      type: Number,
      required: true
    },
    description: String,
    isExempt: {
      type: Boolean,
      default: false
    },
    exemptionReason: String
  }],
  
  // Status and metadata
  status: {
    type: String,
    enum: ["active", "inactive", "draft"],
    default: "active"
  },
  
  effectiveDate: {
    type: Date,
    default: Date.now
  },
  
  expiryDate: Date,
  
  metadata: {
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    version: {
      type: Number,
      default: 1
    },
    notes: String
  }
}, {
  timestamps: true
});

// Indexes
vatConfigSchema.index({ status: 1, effectiveDate: 1 });
vatConfigSchema.index({ "categories.code": 1 });
vatConfigSchema.index({ expiryDate: 1 });

// Method to get current VAT rate for a category
vatConfigSchema.methods.getVATRate = function(categoryCode = null) {
  if (!categoryCode) {
    return this.rates.standard;
  }
  
  const category = this.categories.find(cat => cat.code === categoryCode);
  if (category) {
    return category.isExempt ? 0 : category.rate;
  }
  
  return this.rates.standard;
};

// Method to determine VAT responsibility
vatConfigSchema.methods.getVATResponsibility = function(vendorData, transactionAmount) {
  // Check if vendor is registered for VAT
  if (vendorData.vatRegistered) {
    return "vendor";
  }
  
  // Check if transaction amount exceeds platform threshold
  if (this.responsibility.platform.threshold && 
      transactionAmount > this.responsibility.platform.threshold) {
    return "platform";
  }
  
  // Check vendor annual turnover
  if (vendorData.annualTurnover > this.thresholds.registration) {
    return "vendor";
  }
  
  // Default to platform responsibility
  return "platform";
};

// Method to calculate VAT amount
vatConfigSchema.methods.calculateVAT = function(amount, categoryCode = null) {
  const rate = this.getVATRate(categoryCode);
  return (amount * rate) / 100;
};

// Static method to get active VAT configuration
vatConfigSchema.statics.getActiveConfig = function() {
  const now = new Date();
  return this.findOne({
    status: "active",
    effectiveDate: { $lte: now },
    $or: [
      { expiryDate: { $exists: false } },
      { expiryDate: { $gt: now } }
    ]
  }).sort({ effectiveDate: -1 });
};

// Static method to create VAT configuration
vatConfigSchema.statics.createConfig = function(configData) {
  const config = new this(configData);
  
  // Set version
  if (!config.metadata.version) {
    config.metadata.version = 1;
  }
  
  return config.save();
};

module.exports = mongoose.model("VATConfig", vatConfigSchema);
