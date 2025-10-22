const mongoose = require("mongoose");

// Notification preferences schema for users
const notificationPreferencesSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
    index: true
  },
  // Push notification preferences
  pushNotifications: {
    enabled: {
      type: Boolean,
      default: true
    },
    orderUpdates: {
      type: Boolean,
      default: true
    },
    deliveryUpdates: {
      type: Boolean,
      default: true
    },
    promotions: {
      type: Boolean,
      default: true
    },
    securityAlerts: {
      type: Boolean,
      default: true
    },
    systemUpdates: {
      type: Boolean,
      default: true
    },
    chatMessages: {
      type: Boolean,
      default: true
    },
    ratingReminders: {
      type: Boolean,
      default: true
    }
  },
  // Email notification preferences
  emailNotifications: {
    enabled: {
      type: Boolean,
      default: true
    },
    orderUpdates: {
      type: Boolean,
      default: true
    },
    deliveryUpdates: {
      type: Boolean,
      default: true
    },
    promotions: {
      type: Boolean,
      default: false
    },
    securityAlerts: {
      type: Boolean,
      default: true
    },
    systemUpdates: {
      type: Boolean,
      default: true
    },
    weeklyDigest: {
      type: Boolean,
      default: false
    },
    monthlyReport: {
      type: Boolean,
      default: false
    }
  },
  // SMS notification preferences
  smsNotifications: {
    enabled: {
      type: Boolean,
      default: false
    },
    orderUpdates: {
      type: Boolean,
      default: false
    },
    deliveryUpdates: {
      type: Boolean,
      default: false
    },
    securityAlerts: {
      type: Boolean,
      default: true
    },
    verificationCodes: {
      type: Boolean,
      default: true
    }
  },
  // Quiet hours (when notifications should be muted)
  quietHours: {
    enabled: {
      type: Boolean,
      default: false
    },
    startTime: {
      type: String, // Format: "22:00"
      default: "22:00"
    },
    endTime: {
      type: String, // Format: "08:00"
      default: "08:00"
    },
    timezone: {
      type: String,
      default: "Africa/Lagos"
    }
  },
  // Frequency settings
  frequency: {
    push: {
      type: String,
      enum: ["immediate", "batched", "daily"],
      default: "immediate"
    },
    email: {
      type: String,
      enum: ["immediate", "batched", "daily", "weekly"],
      default: "immediate"
    }
  },
  // Language preference for notifications
  language: {
    type: String,
    default: "en",
    enum: ["en", "fr", "es", "pt", "ar", "sw"]
  },
  // Last updated timestamp
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
notificationPreferencesSchema.index({ user: 1 });
notificationPreferencesSchema.index({ "pushNotifications.enabled": 1 });
notificationPreferencesSchema.index({ "emailNotifications.enabled": 1 });

// Method to check if user wants to receive a specific type of notification
notificationPreferencesSchema.methods.shouldReceiveNotification = function(type, channel) {
  const preferences = this[`${channel}Notifications`];
  
  if (!preferences || !preferences.enabled) {
    return false;
  }
  
  // Check if quiet hours are active
  if (this.quietHours.enabled && channel === 'push') {
    const now = new Date();
    const currentTime = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      timeZone: this.quietHours.timezone 
    });
    
    const startTime = this.quietHours.startTime;
    const endTime = this.quietHours.endTime;
    
    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startTime > endTime) {
      if (currentTime >= startTime || currentTime <= endTime) {
        return false;
      }
    } else {
      if (currentTime >= startTime && currentTime <= endTime) {
        return false;
      }
    }
  }
  
  // Check specific notification type preference
  return preferences[type] !== undefined ? preferences[type] : true;
};

// Method to get all enabled notification types for a channel
notificationPreferencesSchema.methods.getEnabledNotificationTypes = function(channel) {
  const preferences = this[`${channel}Notifications`];
  const enabledTypes = [];
  
  if (!preferences || !preferences.enabled) {
    return enabledTypes;
  }
  
  Object.keys(preferences).forEach(key => {
    if (key !== 'enabled' && preferences[key] === true) {
      enabledTypes.push(key);
    }
  });
  
  return enabledTypes;
};

module.exports = mongoose.model("NotificationPreferences", notificationPreferencesSchema);
