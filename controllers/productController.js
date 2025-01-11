const Product = require("../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../models/categoryModel");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");

const createProductCategory = asyncHandler(async (req, res) => {
  const name = req.body.name;
  if(!Validate.string(name)){
    ThrowError("Invalid Name"); 
  }
  const findCategory = await Category.findOne({ name: name });
  if (!findCategory) {
    // Create new Store
    const newCategory = await Category.create({
      name: name,
    });
    res.json(newCategory);
  } else {
    res.json({
      msg: "Category already exists",
      success: false,
    });
    throw new Error("Category already exists");
  }
});

const updateProductCategory = asyncHandler(async (req, res) => {
  const { id, name } = req.body;
  validateMongodbId(id);
  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }
  try {
    if (name) {
      req.body.slug = slugify(name);
    }
    const updatedCategory = await Category.findByIdAndUpdate(id, name, {
      new: true,
    });
    res.json(updatedCategory);
  } catch (error) {
    throw new Error(error);
  }
});

const createProduct = asyncHandler(async (req, res) => {
  const { title, price, quantity, category, brand, description,  } = req.body;
  validateMongodbId(category);
  // Validate input data
  if (!Validate.string(title)) {
    ThrowError("Invalid Title");
  }
  if (!Validate.integer(price) || price <= 0) {
    ThrowError("Invalid Price");
  }
  if (!Validate.integer(quantity) || quantity < 0) {
    ThrowError("Invalid Quantity");
  }
 
  if (!Validate.string(brand)) {
    ThrowError("Invalid Brand");
  }
  if (!Validate.string(description)) {
    ThrowError("Invalid Description");
  }

  const sellersPrice = price;
  const commission = (sellersPrice * 2) / 100;
  const listedPrice = sellersPrice + commission;

  try {
    let newProduct = await Product.create({
      title: title,
      slug: slugify(title),
      price: sellersPrice,
      listedPrice: listedPrice,
      quantity: quantity,
      category: category,
      brand: brand,
      description: description,
      store: req.store,
    });
    newProduct = await newProduct.populate("store", "name image");

    res.json(newProduct);
  } catch (error) {
    throw new Error(error);
  }
});

const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate input data
  if (req.body.title && !Validate.string(req.body.title)) {
    ThrowError("Invalid Title");
  }
  if (req.body.price && (!Validate.float(req.body.price) || req.body.price <= 0)) {
    ThrowError("Invalid Price");
  }
  if (req.body.quantity && (!Validate.integer(req.body.quantity) || req.body.quantity < 0)) {
    ThrowError("Invalid Quantity");
  }
  if (req.body.category && !Validate.string(req.body.category)) {
    ThrowError("Invalid Category");
  }
  if (req.body.brand && !Validate.string(req.body.brand)) {
    ThrowError("Invalid Brand");
  }
  if (req.body.description && !Validate.string(req.body.description)) {
    ThrowError("Invalid Description");
  }

  // Update slug if title is provided
  if (req.body.title) {
    req.body.slug = slugify(req.body.title);
  }

  try {
    const updatedProduct = await Product.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true, // Ensure that the update runs validation
    });

    if (!updatedProduct) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(updatedProduct);
  } catch (error) {
    throw new Error(error);
  }
});

const deleteProduct = asyncHandler(async (req, res) => {
  const {id} = req.body;
  try {
    const deleteProduct = await Product.findOneAndDelete(id);
    res.json({
      message: "Product deleted successfully",
    });
  } catch (error) {
    throw new Error(error);
  }
});

const getAProduct = asyncHandler(async (req, res) => {
  const { id } = req.body;
  try {
    const findProduct = await Product.findById(id).populate("store", "name image mobile address");
    res.json(findProduct);
  } catch (error) {
    throw new Error(error);
  }
});

const getAllProducts = asyncHandler(async (req, res) => {
  let {page , limit} = req.body;
  if (!Validate.integer(page) || page <= 0) {
    page = 1;
  }
  if (!Validate.integer(limit) || limit <= 0) {
    limit = 30;
  }
  try {
    const totalProducts = await Product.countDocuments({ quantity: { $gt: 0 } });
    const totalPages = Math.ceil(totalProducts / limit);
    const findProduct = await Product.aggregate([
      { $match: { quantity: { $gt: 0 } } }, // Match products with stock > 0
      { $sort: { created_at: -1 } }, // Sort by creation date (descending)
      { $skip: (page - 1) * 30 }, // Skip previous pages
      { $limit: 30 }, // Limit to 30 products
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
          "storeDetails.mobile": 1,// Include store mobile
          "storeDetails.image": 1
        }
      }
    ]);

    res.json({
      data: findProduct,
      totalProducts,
      totalPages,
      currentPage: page,
    });
    
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  createProductCategory,
  updateProductCategory
};
