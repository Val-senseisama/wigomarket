const Product = require("../../models/productModel");
const Store = require("../../models/storeModel");
const asyncHandler = require("express-async-handler");
const { ThrowError } = require("../../Helpers/Helpers");

/**
 * @function search
 * @description Search for products and stores
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.query.search - Search keyword (optional)
 * @returns {Object} - Search results containing products and stores
 * @throws {Error} - Throws error if search fails
 */
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

module.exports = search;
