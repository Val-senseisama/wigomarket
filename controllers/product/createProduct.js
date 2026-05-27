const Product = require("../../models/productModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const Category = require("../../models/categoryModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const { Validate } = require("../../Helpers/Validate");
const { ThrowError } = require("../../Helpers/Helpers");
const audit = require("../../services/auditService");

/**
 * @function createProduct
 * @description Create a new product for the authenticated seller's store.
 *              Product images must be Cloudinary URLs — upload them via
 *              POST /api/upload/signature before calling this endpoint.
 * @param {string}   req.body.title       - Product title (required)
 * @param {number}   req.body.price       - Seller's price in NGN (required)
 * @param {number}   req.body.quantity    - Stock quantity (required)
 * @param {string}   req.body.category    - Category ID (required)
 * @param {string}   req.body.brand       - Brand name (required)
 * @param {string}   req.body.description - Product description (required)
 * @param {string[]} [req.body.images]    - Array of Cloudinary URLs (optional, max 5)
 */
const createProduct = asyncHandler(async (req, res) => {
  const { title, price, quantity, category, brand, description, images } = req.body;

  validateMongodbId(category);

  if (!Validate.string(title))                          ThrowError("Invalid Title");
  if (!Validate.integer(price) || price <= 0)           ThrowError("Invalid Price");
  if (!Validate.integer(quantity) || quantity < 0)      ThrowError("Invalid Quantity");
  if (!Validate.string(brand))                          ThrowError("Invalid Brand");
  if (!Validate.string(description))                    ThrowError("Invalid Description");

  // ── Image validation ────────────────────────────────────────────────────
  let validatedImages = [];
  if (images !== undefined) {
    if (!Array.isArray(images)) {
      return res.status(400).json({
        success: false,
        message: "images must be an array of Cloudinary URLs",
      });
    }
    if (images.length > 5) {
      return res.status(400).json({
        success: false,
        message: "A maximum of 5 product images are allowed",
      });
    }
    const invalidUrls = images.filter((url) => !Validate.cloudinaryUrl(url));
    if (invalidUrls.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "All images must be valid Cloudinary URLs. Upload them via POST /api/upload/signature first.",
        invalidUrls,
      });
    }
    validatedImages = images;
  }

  const sellersPrice  = price;
  const commission    = (sellersPrice * 2) / 100;
  const listedPrice   = sellersPrice + commission;

  try {
    let newProduct = await Product.create({
      title,
      slug: slugify(title),
      price: sellersPrice,
      listedPrice,
      quantity,
      category,
      brand,
      description,
      images: validatedImages,
      store: req.store,
    });
    newProduct = await newProduct.populate("store", "name image");

    audit.log({
      action: "product.created",
      actor: audit.actor(req),
      resource: { type: "product", id: newProduct._id, displayName: title },
      changes: {
        after: { title, price: sellersPrice, listedPrice, quantity, category, brand, imageCount: validatedImages.length },
      },
    });

    res.status(201).json(newProduct);
  } catch (error) {
    throw new Error(error);
  }
});

module.exports = createProduct;
