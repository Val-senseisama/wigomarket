const asyncHandler = require("express-async-handler");
const Order = require("../../models/orderModel");
const DispatchProfile = require("../../models/dispatchProfileModel");
const User = require("../../models/userModel");
const { validateMongodbId } = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");

const getDispatchOrders = asyncHandler(async (req, res) => {
  try {
    const dipatchOrders = await Order.find({ deliveryMethod: "delivery_agent" })
      .populate({
        path: "orderedBy",
        select: "firstname, lastname, nickname, mobile, email, address",
        model: "User",
      })
      .populate({
        path: "products.product",
        select: "store",
        model: "Product",
        populate: {
          path: "store",
          select: "address, owner",
          model: "Store",
          populate: {
            path: "owner",
            select: "mobile, email",
            model: "User",
          },
        },
      })
      .exec();
    res.json(dipatchOrders);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = getDispatchOrders;
