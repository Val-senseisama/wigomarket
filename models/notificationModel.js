const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: [
        // Order related
        "order_placed",
        "order_confirmed",
        "order_dispatched",
        "order_delivered",
        "order_cancelled",
        "order_refunded",
        
        // Payment related
        "payment_received",
        "payment_failed",
        "payment_refunded",
        "payout_processed",
        
        // Store related
        "store_approved",
        "store_rejected",
        "store_suspended",
        "product_approved",
        "product_rejected",
        
        // Dispatch related
        "dispatch_assigned",
        "dispatch_request",
        "dispatch_completed",
        "dispatch_rating_received",
        
        // User related
        "profile_updated",
        "password_changed",
        "account_verified",
        "account_suspended",
        
        // System related
        "maintenance",
        "update_available",
        "promotion",
        "announcement",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    channels: {
      inApp: {
        enabled: {
          type: Boolean,
          default: true,
        },
        read: {
          type: Boolean,
          default: false,
        },
        readAt: {
          type: Date,
        },
      },
      email: {
        enabled: {
          type: Boolean,
          default: false,
        },
        sent: {
          type: Boolean,
          default: false,
        },
        sentAt: {
          type: Date,
        },
        template: {
          type: String,
        },
      },
      sms: {
        enabled: {
          type: Boolean,
          default: false,
        },
        sent: {
          type: Boolean,
          default: false,
        },
        sentAt: {
          type: Date,
        },
      },
      push: {
        enabled: {
          type: Boolean,
          default: false,
        },
        sent: {
          type: Boolean,
          default: false,
        },
        sentAt: {
          type: Date,
        },
        deviceTokens: [String],
      },
    },
    relatedEntity: {
      type: {
        type: String,
        enum: ["order", "product", "store", "user", "dispatch", "payment"],
      },
      id: {
        type: mongoose.Schema.Types.ObjectId,
      },
    },
    role: {
      type: String,
      enum: ["buyer", "seller", "dispatch", "admin", "all"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "sent", "delivered", "failed", "cancelled"],
      default: "pending",
    },
    scheduledFor: {
      type: Date,
    },
    expiresAt: {
      type: Date,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
    },
    errorMessage: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
notificationSchema.index({ recipient: 1, "channels.inApp.read": 1 });
notificationSchema.index({ type: 1, role: 1 });
notificationSchema.index({ status: 1, scheduledFor: 1 });
notificationSchema.index({ "relatedEntity.type": 1, "relatedEntity.id": 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// Virtual for checking if notification is expired
notificationSchema.virtual("isExpired").get(function () {
  return this.expiresAt && this.expiresAt < new Date();
});

// Virtual for checking if notification should be sent
notificationSchema.virtual("shouldSend").get(function () {
  const now = new Date();
  return (
    this.status === "pending" &&
    (!this.scheduledFor || this.scheduledFor <= now) &&
    !this.isExpired
  );
});

// Method to mark as read
notificationSchema.methods.markAsRead = function () {
  this.channels.inApp.read = true;
  this.channels.inApp.readAt = new Date();
  return this.save();
};

// Method to mark as sent
notificationSchema.methods.markAsSent = function (channel) {
  if (this.channels[channel]) {
    this.channels[channel].sent = true;
    this.channels[channel].sentAt = new Date();
  }
  this.status = "sent";
  return this.save();
};

// Method to mark as failed
notificationSchema.methods.markAsFailed = function (errorMessage) {
  this.status = "failed";
  this.errorMessage = errorMessage;
  this.retryCount += 1;
  return this.save();
};

// Static method to create notification
notificationSchema.statics.createNotification = function (notificationData) {
  const notification = new this(notificationData);
  
  // Set default expiration (30 days from now)
  if (!notification.expiresAt) {
    notification.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  
  return notification.save();
};

// Static method to get unread notifications for a user
notificationSchema.statics.getUnreadNotifications = function (userId, limit = 50) {
  return this.find({
    recipient: userId,
    "channels.inApp.enabled": true,
    "channels.inApp.read": false,
    status: { $in: ["pending", "sent", "delivered"] },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("sender", "firstname lastname image")
    .populate("relatedEntity.id");
};

// Static method to mark all notifications as read for a user
notificationSchema.statics.markAllAsRead = function (userId) {
  return this.updateMany(
    {
      recipient: userId,
      "channels.inApp.enabled": true,
      "channels.inApp.read": false,
    },
    {
      $set: {
        "channels.inApp.read": true,
        "channels.inApp.readAt": new Date(),
      },
    }
  );
};

//Export the model
module.exports = mongoose.model("Notification", notificationSchema);
