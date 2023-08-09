const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../utils/validateMongodbId");

// Create Store
const createStore = asyncHandler(async (req, res) => {
  const name = req.body.name;
  const findStore = await Store.findOne({ name: name });
  const user = req.user;

  if (!findStore) {
    // Create new Store
    const newStore = await Store.create({
      name: req.body.name,
      mobile: req.body.mobile,
      email: req.body.email,
      owner: user?._id,
    });
    res.json(newStore);
  } else {
    res.json({
      msg: "Store already exists",
      success: false,
    });
    throw new Error("Store already exists");
  }
});

const getAllStores = asyncHandler(async (req, res) => {
  try {
    const getStores = await Store.find();
    res.json(getStores);
  } catch (error) {
    throw new Error(error);
  }
});

const search = asyncHandler(async (req, res) => {
  const keyword = req.query.search
    ? {
        $or: [
          { name: { $regex: req.query.search, $options: "i" } },
          { title: { $regex: req.query.search, $options: "i" } },
          { description: { $regex: req.query.search, $options: "i" } },
        ],
      }
    : {};
  const products = await Product.find(keyword);
  const stores = await Store.find(keyword);
  let results = products.concat(stores);
  res.send(results);
});

// Get a Single Store

const getAStore = asyncHandler(async (req, res) => {
  const { id } = req.params;
  try {
    const getStore = await Store.findById(id);
    res.json(getStore);
  } catch (error) {
    throw new Error(error);
  }
});

const getMyStore = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  try {
    const myStore = await Store.findOne({ owner: _id });
    res.json(myStore);
  } catch (error) {
    throw new Error(error);
  }
});

const updateBankDetails = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { bankName, aza, accountName, bankCode } = req.body;
  try {
    const myStore = await Store.findOneAndUpdate(
      { owner: _id },
      {
        $set: {
          bankDetails: {
            accountName: accountName,
            aza: aza,
            bankCode: bankCode,
            bankName: bankName,
          },
        },
      },
      { new: true }
    );
    res.json(myStore);
  } catch (error) {
    throw new Error(error);
  }
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  validateMongoDbId(id);
  try {
    const updatedOrderStatus = await Order.findByIdAndUpdate(
      id,
      {
        orderStatus: status,
        paymentIntent: {
          status: status,
        },
      },
      { new: true }
    );
    res.json(updatedOrderStatus);
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = {
  createStore,
  getAStore,
  getAllStores,
  search,
  getMyStore,
  updateBankDetails,
};
