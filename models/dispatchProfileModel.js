const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var dispatchProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    vehicleInfo: {
      type: {
        type: String,
        enum: ["bike", "motorcycle", "car", "van", "truck"],
        required: true,
      },
      make: {
        type: String,
        required: true,
      },
      model: {
        type: String,
        required: true,
      },
      year: {
        type: Number,
        required: true,
      },
      plateNumber: {
        type: String,
        required: true,
        unique: true,
      },
      color: {
        type: String,
        required: true,
      },
    },
    coverageAreas: [
      {
        name: {
          type: String,
          required: true,
        },
        coordinates: {
          latitude: {
            type: Number,
            required: true,
          },
          longitude: {
            type: Number,
            required: true,
          },
        },
        radius: {
          type: Number, // in kilometers
          default: 5,
        },
      },
    ],
    availability: {
      status: {
        type: String,
        enum: ["online", "offline", "busy", "unavailable"],
        default: "offline",
      },
      workingHours: {
        start: {
          type: String, // Format: "09:00"
          default: "09:00",
        },
        end: {
          type: String, // Format: "17:00"
          default: "17:00",
        },
      },
      workingDays: {
        type: [String],
        enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
        default: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      },
    },
    documents: {
      driverLicense: {
        number: {
          type: String,
          required: true,
        },
        expiryDate: {
          type: Date,
          required: true,
        },
        image: {
          type: String, // URL to uploaded image
        },
        verified: {
          type: Boolean,
          default: false,
        },
      },
      vehicleRegistration: {
        number: {
          type: String,
          required: true,
        },
        expiryDate: {
          type: Date,
          required: true,
        },
        image: {
          type: String, // URL to uploaded image
        },
        verified: {
          type: Boolean,
          default: false,
        },
      },
      insurance: {
        provider: {
          type: String,
          required: true,
        },
        policyNumber: {
          type: String,
          required: true,
        },
        expiryDate: {
          type: Date,
          required: true,
        },
        image: {
          type: String, // URL to uploaded image
        },
        verified: {
          type: Boolean,
          default: false,
        },
      },
    },
    rating: {
      average: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      totalReviews: {
        type: Number,
        default: 0,
      },
      breakdown: {
        punctuality: {
          type: Number,
          default: 0,
          min: 0,
          max: 5,
        },
        communication: {
          type: Number,
          default: 0,
          min: 0,
          max: 5,
        },
        handling: {
          type: Number,
          default: 0,
          min: 0,
          max: 5,
        },
        professionalism: {
          type: Number,
          default: 0,
          min: 0,
          max: 5,
        },
      },
    },
    earnings: {
      totalEarnings: {
        type: Number,
        default: 0,
      },
      totalDeliveries: {
        type: Number,
        default: 0,
      },
      averageDeliveryTime: {
        type: Number, // in minutes
        default: 0,
      },
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    lastActiveAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
dispatchProfileSchema.index({ user: 1 });
dispatchProfileSchema.index({ "coverageAreas.coordinates.latitude": 1, "coverageAreas.coordinates.longitude": 1 });
dispatchProfileSchema.index({ "availability.status": 1, "availability.workingDays": 1 });
dispatchProfileSchema.index({ status: 1, isActive: 1 });

//Export the model
module.exports = mongoose.model("DispatchProfile", dispatchProfileSchema);
