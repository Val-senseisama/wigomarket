const mongoose = require("mongoose"); // Erase if already required

// Declare the Schema of the Mongo model
var storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    image: {
      type: String,
    },
    email: {
      type: String,
      unique: true,
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    balance: {
      type: Number,
      default: 0,
    },
    history: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
        },
        count: Number,
        profit: Number,
        created: Date,
      },
    ],
    bankDetails: {
      accountName: {
        type: String,
      },
      bankCode: {
        type: Number,
        length: 3,
      },
      bankName: {
        type: String,
      },
      aza: {
        type: Number,
        length: 10,
      },
    },
  },
  {
    timestamps: true,
  }
);

//Export the model
module.exports = mongoose.model("Store", storeSchema);
