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
        count: Number,
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
    },
    deliveryMethod: {
      type: String,
      enum: ["pickup", "dispatch"],
    },
    deliveryAddress: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

//Export the model
module.exports = mongoose.model("Order", orderSchema);
