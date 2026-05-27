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
 * @function deleteProductCategory
 * @description Delete a product category and its associated products
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.id - Category ID (required)
 * @returns {Object} - Deletion status message
 * @throws {Error} - Throws error if category ID is invalid
 */
const updateProductCategory = asyncHandler(async (req, res) => {
  const { id, name, image } = req.body;
  validateMongodbId(id);

  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }

  if (image !== undefined && !Validate.cloudinaryUrl(image)) {
    return res.status(400).json({
      success: false,
      message:
        "image must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: categories).",
    });
  }

  try {
    const updateFields = {
      name,
      slug: slugify(name),
      ...(image !== undefined && { image }),
    };

    const updatedCategory = await Category.findByIdAndUpdate(
      id,
      updateFields,
      { new: true },
    );
    audit.log({
      action: "category.updated",
      actor: audit.actor(req),
      resource: { type: "category", id, displayName: name },
      changes: { after: { name, ...(image && { image }) } },
    });
    res.json(updatedCategory);
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = updateProductCategory;
