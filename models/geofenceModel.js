const mongoose = require("mongoose");

// Geofence schema for defining delivery zones and restricted areas
const geofenceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  description: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ["delivery_zone", "pickup_zone", "restricted_area", "service_area"],
    required: true,
    index: true
  },
  geometry: {
    type: {
      type: String,
      enum: ["Polygon", "Circle", "Point"],
      required: true
    },
    coordinates: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    }
  },
  center: {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point"
    },
    coordinates: [Number] // [longitude, latitude]
  },
  radius: {
    type: Number, // in meters (for circular geofences)
    min: 0
  },
  bounds: {
    north: Number,
    south: Number,
    east: Number,
    west: Number
  },
  rules: {
    allowedVehicles: [{
      type: String,
      enum: ["bike", "motorcycle", "car", "van", "truck"]
    }],
    maxSpeed: {
      type: Number, // km/h
      default: 50
    },
    timeRestrictions: {
      start: String, // "09:00"
      end: String,   // "17:00"
      days: [{
        type: String,
        enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
      }]
    },
    deliveryFee: {
      type: Number,
      default: 0
    },
    requiresApproval: {
      type: Boolean,
      default: false
    }
  },
  status: {
    type: String,
    enum: ["active", "inactive", "maintenance"],
    default: "active",
    index: true
  },
  priority: {
    type: Number,
    default: 1,
    min: 1,
    max: 10
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  lastModifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  metadata: {
    city: String,
    state: String,
    country: String,
    postalCode: String,
    population: Number,
    averageDeliveryTime: Number, // in minutes
    successRate: Number // percentage
  }
}, {
  timestamps: true
});

// Indexes for efficient geospatial queries
geofenceSchema.index({ "center.coordinates": "2dsphere" });
geofenceSchema.index({ type: 1, status: 1 });
geofenceSchema.index({ priority: -1 });
geofenceSchema.index({ "metadata.city": 1, "metadata.state": 1 });

// Virtual for checking if a point is within the geofence
geofenceSchema.virtual('isPointInside').get(function() {
  return function(longitude, latitude) {
    if (this.geometry.type === 'Circle') {
      const distance = this.calculateDistance(
        this.center.coordinates[1], this.center.coordinates[0],
        latitude, longitude
      );
      return distance <= this.radius;
    }
    // For polygon geofences, you'd implement point-in-polygon logic
    return true; // Placeholder
  };
});

// Method to calculate distance between two points
geofenceSchema.methods.calculateDistance = function(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c; // Distance in meters
};

module.exports = mongoose.model("Geofence", geofenceSchema);
