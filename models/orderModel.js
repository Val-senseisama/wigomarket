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
      enum: ["pickup", "dispatch"],
      required: true,
    },
    deliveryAddress: {
      type: String,
      required: true,
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
