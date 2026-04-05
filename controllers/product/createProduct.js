const Product = require("../../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../../models/categoryModel");
const Order = require("../../models/orderModel");
const Cart = require("../../models/cartModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const Redis = require("ioredis");
const audit = require("../../services/auditService");

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

    audit.log({
      action: "product.created",
      actor: audit.actor(req),
      resource: { type: "product", id: newProduct._id, displayName: title },
      changes: { after: { title, price: sellersPrice, listedPrice, quantity, category, brand } },
    });

    res.json(newProduct);
  } catch (error) {
    throw new Error(error);
  }

});

module.exports = createProduct;
