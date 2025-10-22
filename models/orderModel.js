const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var orderSchema = new mongoose.Schema(
  {
    products: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        count: {
          type: Number,
          required: true,
          min: 1 // Ensure count is at least 1
        },
        stores: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Store",
        },
      },
    ],
    paymentIntent: {},
    orderStatus: {
      type: String,
      default: "Not yet processed",
      enum: [
        "Not yet processed",
        "Pending",
        "Dispatched",
        "Cancelled",
        "Filled",
      ],
    },
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
    deliveryStatus: {
      type: String,
      enum: ["pending_assignment", "assigned", "picked_up", "in_transit", "delivered", "failed"],
      default: "pending_assignment",
    },
    deliveryAgent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function() {
        return this.deliveryMethod === "delivery_agent";
      },
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
    paymentStatus: {
      type: String,
      default: "Not yet paid",
      enum: ["Not yet paid", "Paid"],
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "bank"],
    },
  },
  {
    timestamps: true,
  }
);

//Export the model
module.exports = mongoose.model("Order", orderSchema);
