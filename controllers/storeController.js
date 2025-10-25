const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const User = require("../models/userModel");
const Order = require("../models/orderModel");
const asyncHandler = require("express-async-handler");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");
const Flutterwave = require('flutterwave-node-v3');
const { storeCreationSuccessTemplate, storeAccountUpdateSuccessTemplate } = require("../templates/Emails");
const sendEmail = require("./emailController");
const flw = new Flutterwave(process.env.FLW_PUBLIC_KEY, process.env.FLW_SECRET_KEY);

// Create Store
/**
 * @function createStore
 * @description Create a new store for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} req.user - Authenticated user information
 * @param {string} req.user._id - User ID
 * @param {string} req.user.mobile - User's mobile number
 * @param {string} req.user.email - User's email
 * @param {string[]} req.user.role - User's roles
 * @param {Object} req.body - Store creation data
 * @param {string} req.body.name - Store name (required)
 * @param {string} req.body.address - Store address (required)
 * @param {string} req.body.storeMobile - Store mobile number (required)
 * @param {string} req.body.storeEmail - Store email (required)
 * @param {string} req.body.storeImage - Store image URL (required)
 * @returns {Object} - Created store information
 * @throws {Error} - Throws error if validation fails, store already exists, or creation fails
 */
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
/**
 * @function getAllStores
 * @description Get all stores with selected fields
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Array} - Array of store objects with selected fields
 * @throws {Error} - Throws error if retrieval fails
 */
const getAllStores = asyncHandler(async (req, res) => {
  try {
    const getStores = await Store.find().select('name image email mobile address');
    res.json(getStores);
  } catch (error) {
    throw new Error(error);
  }
});

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

// Get a Single Store
/**
 * @function getAStore
 * @description Get a single store by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Store ID (required)
 * @returns {Object} - Store information
 * @throws {Error} - Throws error if store not found or retrieval fails
 */
const getAStore = asyncHandler(async (req, res) => {
  const { id } = req.body;
  try {
    const getStore = await Store.findById(id);
    res.json(getStore);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function getMyStore
 * @description Get the current user's store
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - User ID
 * @returns {Object} - User's store information
 * @throws {Error} - Throws error if store not found or retrieval fails
 */
const getMyStore = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  try {
    const myStore = await Store.findOne({ owner: _id });
    res.json(myStore);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function updateBankDetails
 * @description Update store's bank details and create subaccount
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - User ID
 * @param {Object} req.body - Bank details
 * @param {string} req.body.bankName - Bank name (required)
 * @param {string} req.body.accountNumber - Account number (required)
 * @param {string} req.body.accountName - Account name (required)
 * @param {string} req.body.bankCode - Bank code (required)
 * @returns {Object} - Updated store information with bank details
 * @throws {Error} - Throws error if validation fails, store not found, or bank details update fails
 */
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
    const myStore = await Store.findOne({ owner: _id }, { _id: 1, name: 1,mobile: 1, email: 1, subAccountDetails: 1 });

    if(!myStore){
      ThrowError("Store not found");
    }

    if(myStore.subAccountDetails.id){
    await flw.Subaccount.delete({
        id: myStore.subAccountDetails.id,
       // Authorization: "Bearer " + process.env.FLW_SECRET_KEY
      })
    }
    
    const details = {
      account_bank: bankCode,
      account_number: accountNumber,
      business_name: myStore.name,
      business_mobile: myStore.mobile,
      business_email: myStore.email ?? req.user.email,
      country: "NG",
      split_type: "percentage",
      split_value: 0.05
      };
     const subAccount = await flw.Subaccount.create(details)
      
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
        to: myStore.email ?? req.user?.email,
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
/**
 * @function updateOrderStatus
 * @description Update the status of an order
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Order ID (required)
 * @param {string} req.body.status - New order status (required)
 * @returns {Object} - Updated order information
 * @throws {Error} - Throws error if validation fails or order update fails
 */
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

/**
 * @function getPopularSellers
 * @description Get popular sellers based on sales, ratings, and activity
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.query.limit=10] - Number of sellers to return
 * @param {string} [req.query.category] - Filter by category
 * @returns {Object} - Array of popular sellers with metrics
 */
const getPopularSellers = asyncHandler(async (req, res) => {
  const { limit = 10, category } = req.query;
  const limitNum = parseInt(limit);

  try {
    // Build aggregation pipeline for popular sellers
    const pipeline = [
      // Match stores that have products
      {
        $match: {
          status: "active",
          ...(category && { "products.category": category })
        }
      },
      // Lookup products for each store
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "store",
          as: "products"
        }
      },
      // Lookup orders for each store's products
      {
        $lookup: {
          from: "orders",
          let: { storeId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ["$$storeId", "$products.store"]
                },
                status: { $in: ["delivered", "completed"] }
              }
            }
          ],
          as: "orders"
        }
      },
      // Lookup ratings for each store
      {
        $lookup: {
          from: "ratings",
          localField: "_id",
          foreignField: "store",
          as: "ratings"
        }
      },
      // Calculate metrics
      {
        $addFields: {
          totalSales: {
            $sum: {
              $map: {
                input: "$orders",
                as: "order",
                in: {
                  $sum: {
                    $map: {
                      input: {
                        $filter: {
                          input: "$$order.products",
                          as: "product",
                          cond: { $eq: ["$$product.store", "$_id"] }
                        }
                      },
                      as: "item",
                      in: { $multiply: ["$$item.count", "$$item.price"] }
                    }
                  }
                }
              }
            }
          },
          totalOrders: { $size: "$orders" },
          totalProducts: { $size: "$products" },
          averageRating: {
            $cond: {
              if: { $gt: [{ $size: "$ratings" }, 0] },
              then: { $avg: "$ratings.rating" },
              else: 0
            }
          },
          totalRatings: { $size: "$ratings" },
          // Calculate popularity score
          popularityScore: {
            $add: [
              { $multiply: ["$totalSales", 0.4] },
              { $multiply: ["$totalOrders", 10] },
              { $multiply: ["$averageRating", 20] },
              { $multiply: ["$totalProducts", 0.1] }
            ]
          }
        }
      },
      // Sort by popularity score
      { $sort: { popularityScore: -1 } },
      // Limit results
      { $limit: limitNum },
      // Project final fields
      {
        $project: {
          _id: 1,
          name: 1,
          address: 1,
          storeImage: 1,
          storeMobile: 1,
          storeEmail: 1,
          status: 1,
          totalSales: 1,
          totalOrders: 1,
          totalProducts: 1,
          averageRating: { $round: ["$averageRating", 2] },
          totalRatings: 1,
          popularityScore: { $round: ["$popularityScore", 2] },
          createdAt: 1
        }
      }
    ];

    const popularSellers = await Store.aggregate(pipeline);

    res.json({
      success: true,
      message: "Popular sellers retrieved successfully",
      data: {
        sellers: popularSellers,
        total: popularSellers.length,
        limit: limitNum
      }
    });
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getNearbySellers
 * @description Get sellers near a specific location
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} req.query.lat - Latitude of user location
 * @param {number} req.query.lng - Longitude of user location
 * @param {number} [req.query.radius=10] - Search radius in kilometers
 * @param {number} [req.query.limit=20] - Number of sellers to return
 * @returns {Object} - Array of nearby sellers with distances
 */
const getNearbySellers = asyncHandler(async (req, res) => {
  const { lat, lng, radius = 10, limit = 20 } = req.query;
  const radiusNum = parseFloat(radius);
  const limitNum = parseInt(limit);

  if (!lat || !lng) {
    ThrowError("Latitude and longitude are required");
  }

  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);

  try {
    // Build aggregation pipeline for nearby sellers
    const pipeline = [
      // Match active stores
      {
        $match: {
          status: "active",
          "address.coordinates": { $exists: true }
        }
      },
      // Add distance calculation
      {
        $addFields: {
          distance: {
            $multiply: [
              6371, // Earth's radius in kilometers
              {
                $acos: {
                  $add: [
                    {
                      $multiply: [
                        { $sin: { $multiply: [{ $divide: [userLat, 180] }, Math.PI] } },
                        { $sin: { $multiply: [{ $divide: ["$address.coordinates.lat", 180] }, Math.PI] } }
                      ]
                    },
                    {
                      $multiply: [
                        { $cos: { $multiply: [{ $divide: [userLat, 180] }, Math.PI] } },
                        { $cos: { $multiply: [{ $divide: ["$address.coordinates.lat", 180] }, Math.PI] } },
                        { $cos: { $multiply: [{ $subtract: [{ $divide: [userLng, 180] }, { $divide: ["$address.coordinates.lng", 180] }] }, Math.PI] } }
                      ]
                    }
                  ]
                }
              }
            ]
          }
        }
      },
      // Filter by radius
      {
        $match: {
          distance: { $lte: radiusNum }
        }
      },
      // Lookup products count
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "store",
          as: "products"
        }
      },
      // Lookup ratings
      {
        $lookup: {
          from: "ratings",
          localField: "_id",
          foreignField: "store",
          as: "ratings"
        }
      },
      // Add metrics
      {
        $addFields: {
          totalProducts: { $size: "$products" },
          averageRating: {
            $cond: {
              if: { $gt: [{ $size: "$ratings" }, 0] },
              then: { $avg: "$ratings.rating" },
              else: 0
            }
          },
          totalRatings: { $size: "$ratings" }
        }
      },
      // Sort by distance
      { $sort: { distance: 1 } },
      // Limit results
      { $limit: limitNum },
      // Project final fields
      {
        $project: {
          _id: 1,
          name: 1,
          address: 1,
          storeImage: 1,
          storeMobile: 1,
          storeEmail: 1,
          status: 1,
          distance: { $round: ["$distance", 2] },
          totalProducts: 1,
          averageRating: { $round: ["$averageRating", 2] },
          totalRatings: 1,
          createdAt: 1
        }
      }
    ];

    const nearbySellers = await Store.aggregate(pipeline);

    res.json({
      success: true,
      message: "Nearby sellers retrieved successfully",
      data: {
        sellers: nearbySellers,
        total: nearbySellers.length,
        userLocation: {
          lat: userLat,
          lng: userLng
        },
        searchRadius: radiusNum,
        limit: limitNum
      }
    });
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getSellerStats
 * @description Get detailed statistics for a specific seller
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.storeId - Store ID
 * @returns {Object} - Detailed seller statistics
 */
const getSellerStats = asyncHandler(async (req, res) => {
  const { storeId } = req.params;

  if (!validateMongodbId(storeId)) {
    ThrowError("Invalid store ID");
  }

  try {
    const store = await Store.findById(storeId);
    if (!store) {
      ThrowError("Store not found");
    }

    // Get comprehensive stats
    const [
      products,
      orders,
      ratings,
      recentOrders
    ] = await Promise.all([
      Product.find({ store: storeId }).countDocuments(),
      Order.find({ 
        "products.store": storeId,
        status: { $in: ["delivered", "completed"] }
      }).countDocuments(),
      Store.aggregate([
        { $match: { _id: store._id } },
        {
          $lookup: {
            from: "ratings",
            localField: "_id",
            foreignField: "store",
            as: "ratings"
          }
        },
        {
          $project: {
            averageRating: { $avg: "$ratings.rating" },
            totalRatings: { $size: "$ratings" },
            ratingDistribution: {
              $map: {
                input: [1, 2, 3, 4, 5],
                as: "rating",
                in: {
                  rating: "$$rating",
                  count: {
                    $size: {
                      $filter: {
                        input: "$ratings",
                        as: "r",
                        cond: { $eq: ["$$r.rating", "$$rating"] }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      ]),
      Order.find({ 
        "products.store": storeId 
      })
      .populate('orderedBy', 'fullName email mobile')
      .sort({ createdAt: -1 })
      .limit(5)
    ]);

    const stats = ratings[0] || { averageRating: 0, totalRatings: 0, ratingDistribution: [] };

    res.json({
      success: true,
      message: "Seller statistics retrieved successfully",
      data: {
        store: {
          _id: store._id,
          name: store.name,
          address: store.address,
          storeImage: store.storeImage,
          status: store.status,
          createdAt: store.createdAt
        },
        statistics: {
          totalProducts: products,
          totalOrders: orders,
          averageRating: Math.round(stats.averageRating * 100) / 100,
          totalRatings: stats.totalRatings,
          ratingDistribution: stats.ratingDistribution
        },
        recentOrders: recentOrders.map(order => ({
          _id: order._id,
          customer: {
            name: order.orderedBy.fullName,
            email: order.orderedBy.email,
            mobile: order.orderedBy.mobile
          },
          status: order.status,
          totalAmount: order.totalAmount,
          createdAt: order.createdAt
        }))
      }
    });
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
  getPopularSellers,
  getNearbySellers,
  getSellerStats,
};
