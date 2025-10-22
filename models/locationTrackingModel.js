const mongoose = require("mongoose");

// Location tracking schema for delivery agents
const locationTrackingSchema = new mongoose.Schema({
  deliveryAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true,
    index: true
  },
  currentLocation: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      index: "2dsphere"
    },
    address: {
      type: String,
      required: true
    },
    accuracy: {
      type: Number, // in meters
      default: 10
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  route: {
    startLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: [Number],
      address: String
    },
    endLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: [Number],
      address: String
    },
    waypoints: [{
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: [Number],
      address: String,
      order: Number
    }],
    optimizedRoute: {
      distance: Number, // in meters
      duration: Number, // in seconds
      polyline: String, // encoded polyline
      instructions: [{
        instruction: String,
        distance: Number,
        duration: Number,
        coordinates: [Number]
      }]
    },
    estimatedArrival: {
      type: Date,
      index: true
    }
  },
  status: {
    type: String,
    enum: ["assigned", "en_route", "arrived", "delivered", "cancelled"],
    default: "assigned",
    index: true
  },
  trackingHistory: [{
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: [Number],
      address: String
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    accuracy: Number,
    speed: Number, // km/h
    heading: Number, // degrees
    status: String
  }],
  geofences: [{
    name: String,
    type: {
      type: String,
      enum: ["pickup", "delivery", "restricted"],
      required: true
    },
    center: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: [Number]
    },
    radius: Number, // in meters
    enteredAt: Date,
    exitedAt: Date
  }],
  notifications: [{
    type: {
      type: String,
      enum: ["location_update", "geofence_enter", "geofence_exit", "route_deviation", "delivery_complete"],
      required: true
    },
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    sent: {
      type: Boolean,
      default: false
    }
  }],
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
locationTrackingSchema.index({ deliveryAgent: 1, isActive: 1 });
locationTrackingSchema.index({ order: 1, status: 1 });
locationTrackingSchema.index({ "currentLocation.coordinates": "2dsphere" });
locationTrackingSchema.index({ lastUpdated: -1 });
locationTrackingSchema.index({ "trackingHistory.timestamp": -1 });

// TTL index to automatically delete old tracking data after 30 days
locationTrackingSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2592000 });

module.exports = mongoose.model("LocationTracking", locationTrackingSchema);
