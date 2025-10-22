const mongoose = require("mongoose");
const VATConfig = require("./models/vatConfigModel");
require("dotenv").config();

/**
 * Initialize default VAT configuration for Nigerian market
 */
const initializeVATConfig = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URL);
    console.log("Connected to MongoDB");

    // Check if VAT config already exists
    const existingConfig = await VATConfig.findOne({ status: "active" });
    
    if (existingConfig) {
      console.log("VAT configuration already exists:", existingConfig._id);
      return existingConfig;
    }

    // Create default VAT configuration
    const vatConfig = await VATConfig.createConfig({
      rates: {
        standard: 7.5, // Nigerian standard VAT rate
        reduced: 0,    // Reduced rate for certain goods
        zero: 0        // Zero-rated goods
      },
      
      thresholds: {
        registration: 25000000, // 25M NGN annual turnover threshold
        collection: 1000000     // 1M NGN minimum collection threshold
      },
      
      responsibility: {
        platform: {
          conditions: ["all_transactions"],
          categories: [],
          threshold: 0
        },
        vendor: {
          conditions: ["registered_vendor", "above_threshold"],
          categories: [],
          threshold: 25000000 // 25M NGN threshold
        }
      },
      
      remittance: {
        frequency: "monthly",
        dueDate: 21, // 21st of the month
        minimumAmount: 100000 // 100K NGN minimum remittance
      },
      
      categories: [
        {
          name: "Food and Beverages",
          code: "FOOD",
          rate: 7.5,
          description: "Food items and beverages",
          isExempt: false
        },
        {
          name: "Electronics",
          code: "ELECTRONICS",
          rate: 7.5,
          description: "Electronic devices and accessories",
          isExempt: false
        },
        {
          name: "Clothing",
          code: "CLOTHING",
          rate: 7.5,
          description: "Clothing and fashion items",
          isExempt: false
        },
        {
          name: "Books and Educational Materials",
          code: "BOOKS",
          rate: 0,
          description: "Books and educational materials",
          isExempt: true,
          exemptionReason: "Educational materials are zero-rated"
        },
        {
          name: "Medical Supplies",
          code: "MEDICAL",
          rate: 0,
          description: "Medical supplies and equipment",
          isExempt: true,
          exemptionReason: "Medical supplies are zero-rated"
        },
        {
          name: "Agricultural Products",
          code: "AGRICULTURE",
          rate: 0,
          description: "Agricultural products and supplies",
          isExempt: true,
          exemptionReason: "Agricultural products are zero-rated"
        },
        {
          name: "Transportation",
          code: "TRANSPORT",
          rate: 7.5,
          description: "Transportation services",
          isExempt: false
        },
        {
          name: "General Merchandise",
          code: "GENERAL",
          rate: 7.5,
          description: "General merchandise and other items",
          isExempt: false
        }
      ],
      
      status: "active",
      effectiveDate: new Date(),
      metadata: {
        version: 1,
        notes: "Default VAT configuration for Nigerian market"
      }
    });

    console.log("Default VAT configuration created successfully:", vatConfig._id);
    return vatConfig;

  } catch (error) {
    console.error("Error initializing VAT configuration:", error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
};

// Run the initialization if this script is executed directly
if (require.main === module) {
  initializeVATConfig()
    .then(() => {
      console.log("VAT configuration initialization completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("VAT configuration initialization failed:", error);
      process.exit(1);
    });
}

module.exports = { initializeVATConfig };
