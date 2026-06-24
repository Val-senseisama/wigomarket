const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var orderSchema = new mongoose.Schema(
  {
    // Human-friendly sequential order number (e.g. "WM1201") shown in dashboards.
    // Generated atomically at creation via utils/generateOrderNumber.
    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    products: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        count: {
          type: Number,
          required: true,
          min: 1, // Ensure count is at least 1
        },
        store: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Store",
        },
      },
    ],
    paymentIntent: {},
    // Canonical lifecycle state. Transitions are enforced by
    // services/orderTransitionService via the utils/orderStatus state machine.
    orderStatus: {
      type: String,
      default: "pending",
      enum: [
        "pending",
        "confirmed",
        "preparing",
        "pickUpReady",
        "inTransit",
        "delivered",
        "cancelled",
      ],
    },
    // Append-only audit trail of lifecycle transitions, used to render the order
    // timeline. Written by orderTransitionService on every successful transition.
    statusHistory: [
      {
        status: { type: String },
        at: { type: Date, default: Date.now },
        role: { type: String }, // seller | rider | admin | system
        _id: false,
      },
    ],
    orderedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    dispatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      dispatchCommission: {
        type: Number,
      },
    },
    deliveryMethod: {
      type: String,
      enum: ["self_delivery", "delivery_agent"],
      required: true,
    },
    deliveryAddress: {
      type: String,
      required: true,
    },
    // GeoJSON coordinates for map display & distance calculation
    deliveryLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: undefined,
      },
      formattedAddress: {
        type: String,
      },
    },
    deliveryStatus: {
      type: String,
      enum: [
        "pending_assignment",
        "assigned",
        "picked_up",
        "in_transit",
        "delivered",
        "failed",
      ],
      default: "pending_assignment",
    },
    deliveryAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    estimatedDeliveryTime: {
      type: Date,
    },
    actualDeliveryTime: {
      type: Date,
    },
    deliveryNotes: {
      type: String,
    },
    deliveryMetadata: {
      distance: Number, // km
      estimatedTime: Number, // minutes
      calculatedAt: Date,
      storeAddress: String,
      fallback: Boolean, // true if dynamic calculation failed
      error: String, // error message if fallback used
      deliveredAt: Date, // when delivery was confirmed
      confirmedByAgent: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
    deliveryConfirmation: {
      agentConfirmed: { type: Boolean, default: false },
      agentConfirmedAt: Date,
      customerConfirmed: { type: Boolean, default: false },
      customerConfirmedAt: Date,
    },
    // Optimistic lock used by the pending-payment cron
    // Prevents duplicate wallet credits if two server instances race
    processingLock: {
      type: Boolean,
      default: false,
      index: true,
    },
    paymentStatus: {
      type: String,
      default: "Unpaid",
      enum: ["Unpaid", "Pending", "Paid", "Refunded", "Failed", "Not yet paid"],
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "bank"],
    },
    // ID provided by the client (frontend) to prevent duplicate orders
    // from the same action (e.g. double-click)
    clientSideId: {
      type: String,
      index: true,
      sparse: true,
      unique: true,
    },
  },
  {
    timestamps: true,
  },
);

//Export the model
module.exports = mongoose.model("Order", orderSchema);
