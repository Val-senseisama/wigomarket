const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");
const Flutterwave = require('flutterwave-node-v3');
const { storeCreationSuccessTemplate } = require("../templates/Emails");
const sendEmail = require("./emailController");
const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);
// Create Store
const createStore = asyncHandler(async (req, res) => {
const { _id, mobile,role, email } = req.user;
const { name, address, storeMobile, storeEmail, storeImage } = req.body;

  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }

  if (!Validate.string(address)) {
    ThrowError("Invalid Address");
  }

  if (!Validate.string(mobile)) {
    ThrowError("Invalid Mobile Number");
  }


  if (!Validate.string(storeMobile)) {
    ThrowError("Invalid Store Mobile Number");
  }

  if (!Validate.email(storeEmail)) {
    ThrowError("Invalid Store Email");
  }

  if (!Validate.string(storeImage)) {
    ThrowError("Invalid Store Image");
  }
try {
  
    const findStore = await Store.findOne({ name: name }, { _id: 1 });
    const userStore = await Store.findOne({ owner: _id }, { _id: 1 });

    if (userStore) {
      res.json({
        msg: "You already have a store",
        success: false,
      });
      throw new Error("You already have a store");
    }
  
    if (!findStore) {
      // Create new Store
      const newStore = await Store.create({
        name: name,
        mobile: storeMobile ?? mobile,
        email: storeEmail ?? email,
        owner: _id,
        address: address,
      });
      if(!role.includes("seller")){
        await User.findOneAndUpdate(
          { _id: _id },
          {
            $set: {
              role: [...role, "seller"],
            },
          },
          { new: true }
        )
      }
      const emailData = storeCreationSuccessTemplate(name, address);
      const data2 = {
        to: email,
        text: `Hello ${name}`,
        subject: "Store Creation - WigoMarket",
        htm: emailData,
      };
     sendEmail(data2);
      res.json(newStore);
    } else {
      res.json({
        msg: "Store already exists",
        success: false,
      });
      throw new Error("Store already exists");
    }
} catch (error) {
  console.log(error);
  ThrowError(error);
}
});

const getAllStores = asyncHandler(async (req, res) => {
  try {
    const getStores = await Store.find().select('name image email mobile address');
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

 try {
   const products = await Product.aggregate([
     {
       $match: {
         ...keyword,
         quantity: { $gt: 0 }
       }
     },
     {
       $lookup: {
         from: "stores", // The name of the stores collection
         localField: "store", // Field from the products collection
         foreignField: "_id", // Field from the stores collection
         as: "storeDetails" // Name of the new array field to add
       }
     },
     {
       $unwind: {
         path: "$storeDetails", // Unwind the storeDetails array
         preserveNullAndEmptyArrays: true // Keep products without a store
       }
     },
     {
       $project: {
         title: 1, // Include product title
         quantity: 1, // Include product quantity
         listedPrice: 1, // Include product listed price
         image: 1, // Include product image
         description: 1, // Include product description
         brand: 1, // Include product brand
         "storeDetails.name": 1, // Include store name
         "storeDetails.address": 1, // Include store address
         "storeDetails.mobile": 1, // Include store mobile
         "storeDetails.image": 1 // Include store image
       }
     }
   ]);
 
   const stores = await Store.find(keyword).select('name image email mobile address');
 let results = {products, stores};
   res.send(results);
 } catch (error) {
  console.log(error);
  ThrowError(error);
 }
});

// Get a Single Store

const getAStore = asyncHandler(async (req, res) => {
  const { id } = req.body;
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
  const { bankName, accountNumber, accountName, bankCode } = req.body;

  if(!Validate.string(bankName)){
    ThrowError("Invalid Bank Name");
  }

  if(!Validate.string(accountNumber)){
    ThrowError("Invalid Account Number");
  }

  if(!Validate.string(accountName)){
    ThrowError("Invalid Account Name");
  }

  if(!Validate.string(bankCode)){
    ThrowError("Invalid Bank Code");
  }

  try {
    const myStore = await Store.findOne({ owner: _id }, { _id: 1, name: 1 });
    
    const details = {
      account_bank: bankCode,
      account_number: accountNumber,
      business_name: myStore.name,
      business_mobile: myStore.mobile,
      country: "NG",
      split_type: "percentage",
      split_value: 0.05
      };
     const subAccount = await flw.Subaccount.create(details)
      .then(console.log)
      .catch(console.log);

      if(!subAccount || subAccount.status !== "success") {
        ThrowError("Unable to create subaccount");
      }

      const updatedStore = await Store.findOneAndUpdate(
        { owner: _id },
        {
          $set: {
            bankDetails: {
              accountName: accountName,
              accountNumber: accountNumber,
              bankCode: bankCode,
              bankName: bankName,
            },
            subAccountDetails: subAccount.data
          },
        },
        { new: true }
      );
      const emailData = storeAccountUpdateSuccessTemplate(bankName, accountNumber, accountName);
      const data2 = {
        to: email,
        text: `Hello ${req.user?.firstname}`,
        subject: "Store Account Update - WigoMarket",
        htm: emailData,
      };
     sendEmail(data2);
    res.json(updatedStore);
  } catch (error) {
    console.log(error);
    throw new Error(error);
  }
});

const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { id } = req.body;
  validateMongoDbId(id);
  try {
    const updatedOrderStatus = await Order.findByIdAndUpdate(
      id,
      {
        orderStatus: status,
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
  updateOrderStatus,
};
