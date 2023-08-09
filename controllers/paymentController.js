const asyncHandler = require("express-async-handler");
const Order = require("../models/orderModel");
const Store = require("../models/storeModel");

const commissionHandler = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  try {
    const order = await Order.findOne({ orderedBy: _id })
      .populate("products.product", "store price listedPrice")
      .populate("products.product.store", "bankDetails");
    res.json(order);
  } catch (error) {
    console.log(error);
  }

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
          [itm.store]: {
            ...itm.store,
            storeId: itm.store,
            storeCommission:
              (fin[itm.store]?.storeCommission || 0) + itm.storeCommission,
            gomarketCommission:
              (fin[itm.store]?.gomarketCommission || 0) +
              itm.gomarketCommission,
          },
        }),
        {}
      )
    );
  let paymentBlocks = blocks(commissions);
  const deets = paymentBlocks.map(
    asyncHandler(async (item) => {
      const azas = await Store.findById(item.storeId, "bankDetails");
      console.log(azas);
      return azas;
    })
  );
  res.json(paymentBlocks);
});

module.exports = { commissionHandler };
