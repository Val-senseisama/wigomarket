const Product = require("../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../models/categoryModel");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
/**
 * @function createProductCategory
 * @description Create a new product category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.name - Name of the category (required)
 * @returns {Object} - Created category information
 * @throws {Error} - Throws error if category already exists or validation fails
 */
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
/**
 * @function deleteProductCategory
 * @description Delete a product category and its associated products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Category ID (required)
 * @returns {Object} - Deletion status message
 * @throws {Error} - Throws error if category ID is invalid
 */
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

const getProductsByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.body; 
  // Validate the category ID
  validateMongodbId(categoryId);

  try {
    const products = await Product.find({ category: categoryId }).populate("store", "name image mobile address"); // Find products by category ID
    res.json(products);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function deleteProductCategory
 * @description Delete a product category and its associated products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Category ID (required)
 * @returns {Object} - Deletion status message
 * @throws {Error} - Throws error if category ID is invalid
 */
const deleteProductCategory = asyncHandler(async (req, res) => {
  const { id } = req.body; // Assuming category ID is passed as a URL parameter

  // Validate the category ID
  validateMongodbId(id);

  try {
    // Optionally, you can delete all products associated with this category
    await Product.deleteMany({ category: id });

    const deletedCategory = await Category.findByIdAndDelete(id);
    if (!deletedCategory) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function getProductCategories
 * @description Get all product categories
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Array} - Array of all product categories
 * @throws {Error} - Throws error if categories retrieval fails
 */
const getProductCategories = asyncHandler(async (req, res) => {

  try {
    const category = await Category.find();
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    res.json(category);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function createProduct
 * @description Create a new product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.title - Product title (required)
 * @param {number} req.body.price - Product price (required)
 * @param {number} req.body.quantity - Product quantity (required)
 * @param {string} req.body.category - Category ID (required)
 * @param {string} req.body.brand - Product brand (required)
 * @param {string} req.body.description - Product description (required)
 * @returns {Object} - Created product information with store details
 * @throws {Error} - Throws error if validation fails or creation fails
 */
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

/**
 * @function updateProduct
 * @description Update an existing product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.id - Product ID (required)
 * @param {Object} req.body - Product update data
 * @param {string} [req.body.title] - Updated product title
 * @param {number} [req.body.price] - Updated product price
 * @param {number} [req.body.quantity] - Updated product quantity
 * @param {string} [req.body.category] - Updated category ID
 * @param {string} [req.body.brand] - Updated product brand
 * @param {string} [req.body.description] - Updated product description
 * @returns {Object} - Updated product information
 * @throws {Error} - Throws error if validation fails or product not found
 */
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

/**
 * @function deleteProduct
 * @description Delete a product
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Product ID (required)
 * @returns {Object} - Deletion status message
 * @throws {Error} - Throws error if deletion fails
 */
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

/**
 * @function getAProduct
 * @description Get a single product by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Product ID (required)
 * @returns {Object} - Product information with store details
 * @throws {Error} - Throws error if product not found or retrieval fails
 */
const getAProduct = asyncHandler(async (req, res) => {
  const { id } = req.body;
  try {
    const findProduct = await Product.findById(id).populate("store", "name image mobile address");
    res.json(findProduct);
  } catch (error) {
    throw new Error(error);
  }
});
/**
 * @function getAllProducts
 * @description Get paginated list of all products with store details
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.body.page=1] - Page number
 * @param {number} [req.body.limit=30] - Number of products per page
 * @returns {Object} - Paginated list of products with store details
 * @throws {Error} - Throws error if retrieval fails
 */
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
  updateProductCategory,
  getProductsByCategory,
  deleteProductCategory,
  getProductCategories
};
