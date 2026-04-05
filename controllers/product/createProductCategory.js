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
    audit.log({
      action: "category.created",
      actor: audit.actor(req),
      resource: { type: "category", id: newCategory._id, displayName: name },
      changes: { after: { name } },
    });
    res.json(newCategory);
  } else {
    return res.status(409).json({
      success: false,
      message: "Category already exists",
    });
  }

});

module.exports = createProductCategory;
