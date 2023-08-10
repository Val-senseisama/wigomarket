const asyncHandler = require("express-async-handler");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");

const commissionHandler = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  try {
    const order = await Order.findOne({ orderedBy: _id }).populate({
      path: "products.product",
      select: "store price listedPrice",
      model: "Product",
      populate: {
        path: "store",
        select: "bankDetails",
        model: "Store",
      },
    });
    let commissions = [];
    order.products.map((item) => {
      let object = {};
      object.storePrice = item.product.price;
      object.listedPrice = item.product.listedPrice;
      object.count = item.count;
      object.storeCommission = object.storePrice * object.count;
      object.gomarketCommission =
        object.listedPrice * object.count - object.storeCommission;
      object.store = item.product.store;
      commissions.push(object);
    });
    const blocks = (commissions) =>
      Object.values(
        commissions.reduce(
          (fin, itm) => ({
            ...fin,
            [itm.store._id]: {
              ...itm.store,
              storeCommission:
                (fin[itm.store._id]?.storeCommission || 0) +
                itm.storeCommission,
              gomarketCommission:
                (fin[itm.store._id]?.gomarketCommission || 0) +
                itm.gomarketCommission,
            },
          }),
          {}
        )
      );
    const payblocks = blocks(commissions).map((item) => {
      return {
        store: (item && item._doc) || null,
        storeCommission: item && item.storeCommission,
        gomarketCommission: item && item.gomarketCommission,
      };
    });
    res.json(payblocks);
  } catch (error) {
    console.log(error);
  }
});

module.exports = { commissionHandler };
