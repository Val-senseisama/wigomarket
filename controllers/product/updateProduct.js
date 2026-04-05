const Product = require("../../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const validateMongodbId = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const audit = require("../../services/auditService");

/**
 * @function updateProduct
 * @description Update an existing product.
 *   - Only whitelisted fields are applied — prevents callers from overwriting
 *     internal fields like `sold`, `views`, `store`, or `rating`.
 *   - Recalculates `listedPrice` (seller price + 2% platform commission)
 *     whenever `price` is updated.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.id - Product ID (required)
 * @param {string}  [req.body.title]
 * @param {number}  [req.body.price]
 * @param {number}  [req.body.quantity]
 * @param {string}  [req.body.category]
 * @param {string}  [req.body.brand]
 * @param {string}  [req.body.description]
 * @param {Array}   [req.body.images]
 * @param {Array}   [req.body.tags]
 * @param {boolean} [req.body.isFeatured]
 */
const updateProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Validate only the fields that were supplied
  if (req.body.title && !Validate.string(req.body.title)) {
    ThrowError("Invalid Title");
  }
  if (
    req.body.price !== undefined &&
    (!Validate.float(req.body.price) || req.body.price <= 0)
  ) {
    ThrowError("Invalid Price");
  }
  if (
    req.body.quantity !== undefined &&
    (!Validate.integer(req.body.quantity) || req.body.quantity < 0)
  ) {
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

  // Whitelist — only these fields may be updated by callers
  const ALLOWED = [
    "title",
    "price",
    "quantity",
    "category",
    "brand",
    "description",
    "images",
    "tags",
    "isFeatured",
  ];
  const updateData = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ success: false, message: "No valid fields to update" });
  }

  // Recompute listedPrice whenever price changes (seller price + 2% commission)
  if (updateData.price !== undefined) {
    const commission = (updateData.price * 2) / 100;
    updateData.listedPrice = updateData.price + commission;
  }

  if (updateData.title) {
    updateData.slug = slugify(updateData.title);
  }

  try {
    const updatedProduct = await Product.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    if (!updatedProduct) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    audit.log({
      action: "product.updated",
      actor: audit.actor(req),
      resource: { type: "product", id: updatedProduct._id, displayName: updatedProduct.title },
      changes: { before: { fieldsChanged: Object.keys(updateData) }, after: updateData },
    });

    res.json(updatedProduct);
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = updateProduct;
