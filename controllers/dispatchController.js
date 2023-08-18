const asyncHandler = require("express-async-handler");
const Order = require("../models/orderModel");

const takeDispatch = asyncHandler(async (req, res) => {
  const { orderedBy } = req.body;
  const { _id } = req.dispatch._id;
  try {
    const dispatchTaken = await Order.findOneAndUpdate(
      { orderedBy: orderedBy },
      { $set: { dispatch: _id } },
      { new: true }
    );

    res.json(dispatchTaken);
  } catch (error) {
    throw new Error(error);
  }
});

const getDispatchOrders = asyncHandler(async (req, res) => {
  try {
    const dipatchOrders = await Order.find({ deliveryMethod: "dispatch" })
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

const dispatchCommission = asyncHandler(async (req, res) => {});

module.exports = { takeDispatch, getDispatchOrders, dispatchCommission };
