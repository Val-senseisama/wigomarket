const Product = require("../models/productModel");
const ProductReview = require("../models/productReviewModel");
const asyncHandler = require("express-async-handler");
const slugify = require("slugify");
const mongoose = require("mongoose");
const Category = require("../models/categoryModel");
const Order = require("../models/orderModel");
const Cart = require("../models/cartModel");
const validateMongodbId = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const redisClient = require("../config/redisClient");
const audit = require("../services/auditService");
const { ThrowError } = require("../Helpers/Helpers");
const money = require("../utils/money");
const {
  validateSpecifications,
  toSpecificationPairs,
  describeSchema,
  describeAllSchemas,
  SPEC_SCHEMA_KEYS,
} = require("../utils/productSpecs");
const { validateVariants, listedPriceFor } = require("../utils/productVariants");
/**
 * Resolve and validate a `parent` category id from a request body.
 * @returns {{ error?: string, parent?: (string|null) }}
 */
const resolveParent = async (parent) => {
  if (parent === undefined) return { parent: undefined };
  if (parent === null || parent === "") return { parent: null };

  if (!mongoose.isValidObjectId(parent)) {
    return { error: "parent must be a valid category id, or null for a top-level category" };
  }
  const parentDoc = await Category.findById(parent).select("parent").lean();
  if (!parentDoc) {
    return { error: "Parent category not found" };
  }
  // Two levels only — the picker renders a category and its children, nothing
  // deeper, and a deeper tree would silently not show up in the UI.
  if (parentDoc.parent) {
    return { error: "Categories are only two levels deep — the chosen parent is itself a subcategory" };
  }
  return { parent };
};

const validateSpecSchemaKey = (specSchema) => {
  if (specSchema === undefined) return { specSchema: undefined };
  if (specSchema === null || specSchema === "") return { specSchema: null };
  if (!SPEC_SCHEMA_KEYS.includes(specSchema)) {
    return { error: `specSchema must be one of: ${SPEC_SCHEMA_KEYS.join(", ")}, or null` };
  }
  return { specSchema };
};

/**
 * @function createProductCategory
 * @description Create a product category. Categories are two levels deep: pass
 *   `parent` to create a subcategory, omit it for a top-level one.
 * @param {string} req.body.name - Name of the category (required, globally unique)
 * @param {string} [req.body.parent] - Parent category id; omit/null for top-level
 * @param {string} [req.body.specSchema] - "phone" | "computer" | null. Inherited by
 *   subcategories that do not set their own, so tagging the parent is usually enough.
 * @param {string} [req.body.image] - Cloudinary URL
 * @returns {Object} - Created category
 */
const createProductCategory = asyncHandler(async (req, res) => {
  const { name, image } = req.body;
  if (!Validate.string(name)) {
    ThrowError("Invalid Name");
  }

  const parentResult = await resolveParent(req.body.parent);
  if (parentResult.error) return invalid(res, parentResult.error);

  const schemaResult = validateSpecSchemaKey(req.body.specSchema);
  if (schemaResult.error) return invalid(res, schemaResult.error);

  const findCategory = await Category.findOne({ name });
  if (findCategory) {
    return res.status(409).json({
      success: false,
      message: "Category already exists",
    });
  }

  const newCategory = await Category.create({
    name,
    ...(image !== undefined && { image }),
    ...(parentResult.parent !== undefined && { parent: parentResult.parent }),
    ...(schemaResult.specSchema !== undefined && { specSchema: schemaResult.specSchema }),
  });

  audit.log({
    action: "product.category_created",
    actor: audit.actor(req),
    resource: { type: "category", id: newCategory._id, displayName: name },
    changes: {
      after: {
        name,
        parent: newCategory.parent,
        specSchema: newCategory.specSchema,
      },
    },
  });

  res.status(201).json({ success: true, data: newCategory });
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
/**
 * @function updateProductCategory
 * @description Partial update of a category. Only the supplied fields change.
 * @param {string} req.body.id - Category ID (required)
 * @param {string} [req.body.name]
 * @param {string} [req.body.image]
 * @param {string} [req.body.parent] - null to promote a subcategory to top level
 * @param {string} [req.body.specSchema] - "phone" | "computer" | null
 */
const updateProductCategory = asyncHandler(async (req, res) => {
  const { id, name, image } = req.body;
  validateMongodbId(id);

  if (name !== undefined && !Validate.string(name)) {
    ThrowError("Invalid Name");
  }

  const parentResult = await resolveParent(req.body.parent);
  if (parentResult.error) return invalid(res, parentResult.error);

  const schemaResult = validateSpecSchemaKey(req.body.specSchema);
  if (schemaResult.error) return invalid(res, schemaResult.error);

  if (parentResult.parent && String(parentResult.parent) === String(id)) {
    return invalid(res, "A category cannot be its own parent");
  }

  // Demoting a category that already has children would create a third level.
  if (parentResult.parent) {
    const hasChildren = await Category.exists({ parent: id });
    if (hasChildren) {
      return invalid(
        res,
        "This category has subcategories, so it cannot itself become a subcategory — categories are only two levels deep",
      );
    }
  }

  // Build the update explicitly. The previous version passed `name` (a string)
  // as the whole update document, so no field was ever actually written.
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (image !== undefined) updates.image = image;
  if (parentResult.parent !== undefined) updates.parent = parentResult.parent;
  if (schemaResult.specSchema !== undefined) updates.specSchema = schemaResult.specSchema;

  if (Object.keys(updates).length === 0) {
    return invalid(res, "Provide at least one field to update (name, image, parent, specSchema)");
  }

  const updatedCategory = await Category.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  });

  if (!updatedCategory) {
    return res.status(404).json({ success: false, message: "Category not found" });
  }

  audit.log({
    action: "product.category_updated",
    actor: audit.actor(req),
    resource: { type: "category", id, displayName: updatedCategory.name },
    changes: { after: updates },
  });

  res.json({ success: true, data: updatedCategory });
});

const getProductsByCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.body;
  // Validate the category ID
  validateMongodbId(categoryId);

  try {
    const products = await Product.find({ category: categoryId }).populate(
      "store",
      "name image mobile address",
    ); // Find products by category ID
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

    audit.log({
      action: "product.category_deleted",
      actor: audit.actor(req),
      resource: { type: "category", id: id },
    });
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
  const categories = await Category.find().lean();

  // Flat list stays the default so existing clients are unaffected.
  const wantsTree = ["true", "1", "yes"].includes(
    String(req.query.tree || "").toLowerCase(),
  );

  if (!wantsTree) {
    return res.json(categories);
  }

  // Nested shape for the add-product category picker. `specSchema` is resolved
  // here — a subcategory inherits its parent's — so the client can decide
  // whether to show the specification step from the picked category alone,
  // without a second lookup.
  const byParent = new Map();
  const roots = [];

  for (const category of categories) {
    if (category.parent) {
      const key = String(category.parent);
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(category);
    } else {
      roots.push(category);
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name);

  const tree = roots.sort(byName).map((root) => ({
    _id: root._id,
    name: root.name,
    image: root.image,
    specSchema: root.specSchema || null,
    children: (byParent.get(String(root._id)) || []).sort(byName).map((child) => ({
      _id: child._id,
      name: child.name,
      image: child.image,
      // Inherited when the child does not declare its own.
      specSchema: child.specSchema || root.specSchema || null,
      children: [],
    })),
  }));

  // A subcategory whose parent was deleted would otherwise vanish from the
  // picker entirely, making its products uneditable.
  const rootIds = new Set(roots.map((r) => String(r._id)));
  const orphans = [];
  for (const [parentId, children] of byParent) {
    if (!rootIds.has(parentId)) orphans.push(...children);
  }

  res.json({
    success: true,
    data: {
      categories: tree,
      ...(orphans.length && {
        orphaned: orphans.map((c) => ({
          _id: c._id,
          name: c.name,
          parent: c.parent,
          specSchema: c.specSchema || null,
        })),
      }),
    },
  });
});

/**
 * @function getSpecSchemas
 * @description The category-specific specification field sets — labels,
 *   placeholders, whether each field is required, and the allowed values for
 *   dropdowns. The add-product specification step (3/3) renders itself from
 *   this, so a new RAM size or warranty term ships without an app release.
 *
 *   Pass `?category=<id>` to get just the schema that applies to one category
 *   (inheriting from its parent), or nothing to get all of them.
 */
const getSpecSchemas = asyncHandler(async (req, res) => {
  const { category } = req.query;

  if (category) {
    validateMongodbId(category);
    const categoryDoc = await Category.findById(category).lean();
    if (!categoryDoc) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
    const key = await Category.resolveSpecSchema(categoryDoc);
    return res.json({
      success: true,
      data: {
        category: { _id: categoryDoc._id, name: categoryDoc.name },
        // null means this category has no specification step — skip straight
        // from images to publishing.
        specSchema: key ? describeSchema(key) : null,
      },
    });
  }

  res.json({ success: true, data: { specSchemas: describeAllSchemas() } });
});
/** 400 with a list of field errors, matching the add-product form's shape. */
const invalid = (res, message, errors) =>
  res.status(400).json({ success: false, message, ...(errors && { errors }) });

/**
 * Validate the 1-5 Cloudinary image URLs from step 2 of the add-product flow.
 * images[0] is the main display image.
 * @returns {{ error?: string, invalidUrls?: string[], images?: string[] }}
 */
const validateImages = (images) => {
  if (!Array.isArray(images)) {
    return { error: "images must be an array of Cloudinary URLs" };
  }
  if (images.length < 1) {
    return { error: "At least one product image is required — the first is used as the main display image" };
  }
  if (images.length > 5) {
    return { error: "A maximum of 5 product images are allowed" };
  }
  const bad = images.filter((u) => !Validate.cloudinaryUrl(u));
  if (bad.length > 0) {
    return {
      error:
        "All images must be valid Cloudinary URLs. Upload via POST /api/upload/signature (folder: products).",
      invalidUrls: bad,
    };
  }
  return { images };
};

/**
 * @function createProduct
 * @description Create a product for the authenticated seller's store. Covers both
 *   branches of the add-product chooser:
 *
 *     productType "single"    one version — price, quantity and an optional SKU
 *                             live on the product itself.
 *     productType "variable"  several versions — `optionTypes` declares the axes
 *                             (Size, Color, …) and `variants` carries a price,
 *                             stock, SKU and image per version. Top-level price
 *                             and quantity are derived from the variants, so the
 *                             rest of the system needs no special handling.
 *
 *   Product images and video must be Cloudinary URLs — upload them via
 *   POST /api/upload/signature first.
 *
 *   When the chosen category (or its parent) declares a `specSchema`, the
 *   category-specific specification step applies and `specifications` is
 *   validated against it — see utils/productSpecs and
 *   GET /api/product/spec-schemas.
 *
 * @param {string}   req.body.title          - Product name (required)
 * @param {string}   req.body.category       - Category ID (required)
 * @param {string}   req.body.description    - Product description (required)
 * @param {string[]} req.body.images         - 1-5 Cloudinary URLs; [0] is the main image (required)
 * @param {string}   [req.body.productType]  - "single" (default) | "variable"
 * @param {number}   [req.body.price]        - Selling price — required for single
 * @param {number}   [req.body.quantity]     - Stock quantity — required for single
 * @param {string}   [req.body.sku]          - Stock keeping unit, unique within the store
 * @param {Array}    [req.body.optionTypes]  - Required for variable
 * @param {Array}    [req.body.variants]     - Required for variable
 * @param {string}   [req.body.video]        - Optional Cloudinary video URL
 * @param {Object}   [req.body.specifications] - Keyed spec object for spec'd categories
 * @param {string}   [req.body.brand]        - Optional brand name
 */
const createProduct = asyncHandler(async (req, res) => {
  const {
    title, price, quantity, category, brand, description, sku,
    images, video, specifications, sizes, colors,
    optionTypes, variants,
  } = req.body;

  const productType = req.body.productType || "single";
  if (!["single", "variable"].includes(productType)) {
    return invalid(res, 'productType must be either "single" or "variable"');
  }

  validateMongodbId(category);

  if (!Validate.string(title))       ThrowError("Invalid Title");
  if (!Validate.string(description)) ThrowError("Invalid Description");
  // brand is optional — the add-product form does not collect it.
  if (brand !== undefined && !Validate.string(brand)) ThrowError("Invalid Brand");

  // ── Category & its specification schema ──────────────────────────────────
  const categoryDoc = await Category.findById(category).lean();
  if (!categoryDoc) {
    return res.status(404).json({ success: false, message: "Category not found" });
  }
  const specSchemaKey = await Category.resolveSpecSchema(categoryDoc);

  // ── Images (required — step 2 of the flow) ───────────────────────────────
  const imageResult = validateImages(images);
  if (imageResult.error) {
    return invalid(res, imageResult.error, imageResult.invalidUrls);
  }
  const validatedImages = imageResult.images;

  // ── Optional product video ───────────────────────────────────────────────
  let validatedVideo = null;
  if (video !== undefined && video !== null && String(video).trim() !== "") {
    if (!Validate.cloudinaryUrl(video)) {
      return invalid(
        res,
        "video must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: products).",
      );
    }
    validatedVideo = String(video).trim();
  }

  // ── Category-specific specifications ─────────────────────────────────────
  let validatedSpecs = [];
  if (specSchemaKey) {
    const { errors, values } = validateSpecifications(specSchemaKey, specifications ?? {});
    if (errors.length) {
      return invalid(
        res,
        `This category requires ${specSchemaKey} specifications. Fetch the field list from GET /api/product/spec-schemas.`,
        errors,
      );
    }
    validatedSpecs = toSpecificationPairs(specSchemaKey, values);
  } else if (specifications !== undefined) {
    // Categories without a schema keep the free-form { key, value } list.
    if (!Array.isArray(specifications)) {
      return invalid(
        res,
        "This category has no specification schema, so specifications must be an array of { key, value } objects",
      );
    }
    for (const s of specifications) {
      if (!s?.key || !s?.value || typeof s.key !== "string" || typeof s.value !== "string") {
        return invalid(res, "Each specification must have a string key and a string value");
      }
    }
    validatedSpecs = specifications;
  }

  // ── Legacy free-form sizes / colours (kept for existing clients) ─────────
  let validatedSizes = [];
  if (sizes !== undefined) {
    if (!Array.isArray(sizes) || !sizes.every((s) => typeof s === "string")) {
      return invalid(res, "sizes must be an array of strings");
    }
    validatedSizes = sizes;
  }

  let validatedColors = [];
  if (colors !== undefined) {
    if (!Array.isArray(colors)) {
      return invalid(res, "colors must be an array of { name, hex? } objects");
    }
    for (const c of colors) {
      if (!c?.name || typeof c.name !== "string") {
        return invalid(res, "Each color must have a string name field");
      }
    }
    validatedColors = colors;
  }

  // ── Pricing & stock: single vs variable ──────────────────────────────────
  let pricing;
  let validatedOptionTypes = [];
  let validatedVariants = [];

  if (productType === "variable") {
    if (price !== undefined || quantity !== undefined) {
      return invalid(
        res,
        "A multiple-version product is priced and stocked per variant — omit the top-level price and quantity. They are derived from the variants.",
      );
    }

    const result = validateVariants({ optionTypes, variants });
    if (result.errors.length) {
      return invalid(res, "Invalid product versions", result.errors);
    }

    validatedOptionTypes = result.optionTypes;
    validatedVariants = result.variants;
    pricing = result.derived;
  } else {
    if (!Validate.integer(price) || price <= 0)      ThrowError("Invalid Price");
    if (!Validate.integer(quantity) || quantity < 0) ThrowError("Invalid Quantity");
    if (optionTypes !== undefined || variants !== undefined) {
      return invalid(
        res,
        'optionTypes and variants only apply to a multiple-version product — set productType to "variable" to use them.',
      );
    }

    const sellersPrice = money.round(price);
    pricing = {
      price: sellersPrice,
      listedPrice: listedPriceFor(sellersPrice),
      quantity,
    };
  }

  // ── SKU uniqueness within the store ──────────────────────────────────────
  let validatedSku;
  if (sku !== undefined && sku !== null && String(sku).trim() !== "") {
    validatedSku = String(sku).trim();
    const clash = await Product.exists({ store: req.store, sku: validatedSku });
    if (clash) {
      return invalid(res, `SKU '${validatedSku}' is already used by another product in your store`);
    }
  }

  try {
    let newProduct = await Product.create({
      title,
      slug:           slugify(title),
      productType,
      ...(validatedSku && { sku: validatedSku }),
      price:          pricing.price,
      listedPrice:    pricing.listedPrice,
      quantity:       pricing.quantity,
      category,
      ...(brand !== undefined && { brand }),
      description,
      images:         validatedImages,
      video:          validatedVideo,
      specifications: validatedSpecs,
      sizes:          validatedSizes,
      colors:         validatedColors,
      optionTypes:    validatedOptionTypes,
      variants:       validatedVariants,
      store:          req.store,
    });
    newProduct = await newProduct.populate([
      { path: "store",    select: "name image" },
      { path: "category", select: "name parent specSchema" },
    ]);

    audit.log({
      action: "product.created",
      actor: audit.actor(req),
      resource: { type: "product", id: newProduct._id, displayName: title },
      changes: {
        after: {
          title,
          productType,
          sku: validatedSku,
          price: pricing.price,
          listedPrice: pricing.listedPrice,
          quantity: pricing.quantity,
          category,
          brand,
          imageCount: validatedImages.length,
          hasVideo: Boolean(validatedVideo),
          variantCount: validatedVariants.length,
          specSchema: specSchemaKey,
        },
      },
    });

    res.status(201).json({
      success: true,
      data: newProduct,
      // Echo which specification form applied, so a client that skipped step 3
      // can tell whether it should have been shown.
      specSchema: specSchemaKey ? describeSchema(specSchemaKey).key : null,
    });
  } catch (error) {
    // The partial unique index on { store, sku } is the last line of defence
    // against two concurrent creates claiming the same SKU.
    if (error?.code === 11000 && error?.keyPattern?.sku) {
      return invalid(res, `SKU '${validatedSku}' is already used by another product in your store`);
    }
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
  validateMongodbId(id);

  if (req.body.title      && !Validate.string(req.body.title))       ThrowError("Invalid Title");
  if (req.body.brand      && !Validate.string(req.body.brand))       ThrowError("Invalid Brand");
  if (req.body.description && !Validate.string(req.body.description)) ThrowError("Invalid Description");
  if (req.body.price    !== undefined && (!Validate.float(req.body.price)    || req.body.price    <= 0)) ThrowError("Invalid Price");
  if (req.body.quantity !== undefined && (!Validate.integer(req.body.quantity) || req.body.quantity < 0)) ThrowError("Invalid Quantity");

  // Whitelist — callers cannot overwrite internal fields (sold, views, store, rating, etc.)
  const ALLOWED = [
    "title", "price", "quantity", "category", "brand", "description",
    "images", "tags", "isFeatured",
    "specifications", "sizes", "colors",
  ];
  const updateData = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ success: false, message: "No valid fields to update" });
  }

  // Recompute listedPrice when price changes
  if (updateData.price !== undefined) {
    updateData.listedPrice = money.add(
      updateData.price,
      money.percentage(updateData.price, 2),
    );
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
      resource: { type: "product", id, displayName: updatedProduct.title },
      changes: { before: { fieldsChanged: Object.keys(updateData) }, after: updateData },
    });

    res.json({ success: true, data: updatedProduct });
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
  const { id } = req.body;
  try {
    const deleteProduct = await Product.findOneAndDelete(id);
    audit.log({
      action: "product.deleted",
      actor: audit.actor(req),
      resource: { type: "product", id: id },
    });
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
  const { id } = req.params;
  validateMongodbId(id);

  const product = await Product.findById(id)
    .populate("store",    "name image mobile address")
    .populate("category", "name")
    .select("-__v")
    .lean();

  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  // Increment view count (fire-and-forget, non-blocking)
  Product.findByIdAndUpdate(id, { $inc: { views: 1 } }).catch(() => {});

  res.json({ success: true, data: product });
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
  let { page, limit } = req.body;
  if (!Validate.integer(page) || page <= 0) {
    page = 1;
  }
  if (!Validate.integer(limit) || limit <= 0) {
    limit = 30;
  }
  try {
    const totalProducts = await Product.countDocuments({
      quantity: { $gt: 0 },
    });
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
          as: "storeDetails", // Name of the new array field to add
        },
      },
      {
        $unwind: {
          path: "$storeDetails", // Unwind the storeDetails array
          preserveNullAndEmptyArrays: true, // Keep products without a store
        },
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
          "storeDetails.image": 1,
        },
      },
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

/**
 * @function getProducts
 * @description Get products with advanced filtering, sorting, and pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.query.page=1] - Page number
 * @param {number} [req.query.limit=20] - Items per page
 * @param {string} [req.query.category] - Category ID filter
 * @param {string} [req.query.store] - Store ID filter
 * @param {number} [req.query.minPrice] - Minimum price filter
 * @param {number} [req.query.maxPrice] - Maximum price filter
 * @param {string} [req.query.brand] - Brand filter
 * @param {string} [req.query.search] - Search term
 * @param {string} [req.query.sort=newest] - Sort option
 * @param {boolean} [req.query.inStock=true] - In stock filter
 * @returns {Object} - Paginated products with filters
 */
const getProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    category,
    store,
    minPrice,
    maxPrice,
    brand,
    search,
    sort = "newest",
    inStock = true,
  } = req.query;

  // Create cache key
  const cacheKey = `products:${JSON.stringify(req.query)}`;

  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // Build filter object
    const filters = {};
    if (category) {
      validateMongodbId(category);
      filters.category = category;
    }
    if (store) {
      validateMongodbId(store);
      filters.store = store;
    }
    if (minPrice || maxPrice) {
      filters.listedPrice = {};
      if (minPrice) filters.listedPrice.$gte = parseFloat(minPrice);
      if (maxPrice) filters.listedPrice.$lte = parseFloat(maxPrice);
    }
    if (brand) filters.brand = new RegExp(brand, "i");
    if (search) {
      filters.$or = [
        { title: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
        { brand: new RegExp(search, "i") },
      ];
    }
    if (inStock === "true") filters.quantity = { $gt: 0 };

    // Build sort object
    const sortOptions = {};
    switch (sort) {
      case "price_asc":
        sortOptions.listedPrice = 1;
        break;
      case "price_desc":
        sortOptions.listedPrice = -1;
        break;
      case "newest":
        sortOptions.createdAt = -1;
        break;
      case "oldest":
        sortOptions.createdAt = 1;
        break;
      case "popular":
        sortOptions.sold = -1;
        break;
      case "rating":
        sortOptions["rating.average"] = -1;
        break;
      case "views":
        sortOptions.views = -1;
        break;
      default:
        sortOptions.createdAt = -1;
    }

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const products = await Product.find(filters)
      .populate("category", "name")
      .populate("store", "name address mobile image")
      .sort(sortOptions)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Product.countDocuments(filters);

    // Get filter options for response
    const categories = await Category.find({}, "name").limit(10);
    const brands = await Product.distinct("brand", filters);
    const priceRange = await Product.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          min: { $min: "$listedPrice" },
          max: { $max: "$listedPrice" },
        },
      },
    ]);

    const response = {
      success: true,
      data: {
        products,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalProducts: total,
          hasNext: page < Math.ceil(total / parseInt(limit)),
          hasPrev: page > 1,
        },
        filters: {
          categories,
          brands: brands.filter((b) => b),
          priceRange: priceRange[0] || { min: 0, max: 0 },
        },
      },
    };

    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(response));

    // Track search analytics
    if (search) {
      await redisClient.lPush(
        "search_analytics",
        JSON.stringify({
          query: search,
          timestamp: new Date(),
          resultsCount: total,
        }),
      );
    }

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getPersonalizedSuggestions
 * @description Get personalized product suggestions based on user's history
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.user._id - Authenticated user's ID
 * @param {number} [req.query.limit=10] - Number of suggestions
 * @returns {Object} - Personalized product suggestions
 */
const getPersonalizedSuggestions = asyncHandler(async (req, res) => {
  const { _id } = req.user;
  const { limit = 10 } = req.query;

  const cacheKey = `personalized:${_id}:${limit}`;

  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // Get user's order history
    const userOrders = await Order.find({ orderedBy: _id })
      .populate("products.product")
      .sort({ createdAt: -1 })
      .limit(10);

    // Get user's cart items
    const userCart = await Cart.findOne({ owner: _id }).populate(
      "products.product",
    );

    // Extract user preferences
    const userPreferences = {
      categories: [
        ...new Set(
          userOrders.flatMap((order) =>
            order.products
              .map((item) => item.product?.category)
              .filter(Boolean),
          ),
        ),
      ],
      brands: [
        ...new Set(
          userOrders.flatMap((order) =>
            order.products.map((item) => item.product?.brand).filter(Boolean),
          ),
        ),
      ],
      stores: [
        ...new Set(
          userOrders.flatMap((order) =>
            order.products.map((item) => item.product?.store).filter(Boolean),
          ),
        ),
      ],
    };

    // Get suggested products based on preferences
    let suggestions = [];

    if (
      userPreferences.categories.length > 0 ||
      userPreferences.brands.length > 0
    ) {
      const suggestionFilters = {
        quantity: { $gt: 0 },
      };

      if (
        userPreferences.categories.length > 0 ||
        userPreferences.brands.length > 0
      ) {
        suggestionFilters.$or = [];
        if (userPreferences.categories.length > 0) {
          suggestionFilters.$or.push({
            category: { $in: userPreferences.categories },
          });
        }
        if (userPreferences.brands.length > 0) {
          suggestionFilters.$or.push({
            brand: { $in: userPreferences.brands },
          });
        }
      }

      suggestions = await Product.find(suggestionFilters)
        .populate("category", "name")
        .populate("store", "name address")
        .sort({ "rating.average": -1, sold: -1 })
        .limit(parseInt(limit));
    }

    // If no personalized suggestions, get trending products
    if (suggestions.length === 0) {
      suggestions = await Product.find({ quantity: { $gt: 0 } })
        .populate("category", "name")
        .populate("store", "name address")
        .sort({ sold: -1, views: -1 })
        .limit(parseInt(limit));
    }

    const response = {
      success: true,
      data: suggestions,
    };

    // Cache for 30 minutes
    await redisClient.setex(cacheKey, 1800, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getTrendingProducts
 * @description Get trending products based on sales and views
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {number} [req.query.limit=10] - Number of trending products
 * @param {string} [req.query.timeframe=7d] - Timeframe for trending (24h, 7d, 30d)
 * @returns {Object} - Trending products
 */
const getTrendingProducts = asyncHandler(async (req, res) => {
  const { limit = 10, timeframe = "7d" } = req.query;

  const cacheKey = `trending:${timeframe}:${limit}`;

  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    let dateFilter = {};
    const now = new Date();

    switch (timeframe) {
      case "24h":
        dateFilter = {
          createdAt: { $gte: new Date(now - 24 * 60 * 60 * 1000) },
        };
        break;
      case "7d":
        dateFilter = {
          createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
        };
        break;
      case "30d":
        dateFilter = {
          createdAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) },
        };
        break;
    }

    const trending = await Product.find({
      ...dateFilter,
      quantity: { $gt: 0 },
    })
      .populate("category", "name")
      .populate("store", "name address")
      .sort({ sold: -1, views: -1, "rating.average": -1 })
      .limit(parseInt(limit));

    const response = {
      success: true,
      data: trending,
    };

    // Cache for 2 hours
    await redisClient.setex(cacheKey, 7200, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function getCategorySuggestions
 * @description Get product suggestions for a specific category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.categoryId - Category ID
 * @param {number} [req.query.limit=10] - Number of suggestions
 * @returns {Object} - Category-based product suggestions
 */
const getCategorySuggestions = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { limit = 10 } = req.query;

  validateMongodbId(categoryId);

  const cacheKey = `category_suggestions:${categoryId}:${limit}`;

  try {
    // Try to get from cache first
    const cachedData = await redisClient.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    // Get category details
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    // Get products in this category
    const suggestions = await Product.find({
      category: categoryId,
      quantity: { $gt: 0 },
    })
      .populate("category", "name")
      .populate("store", "name address")
      .sort({ "rating.average": -1, sold: -1, views: -1 })
      .limit(parseInt(limit));

    const response = {
      success: true,
      data: {
        category: {
          _id: category._id,
          name: category.name,
        },
        suggestions,
      },
    };

    // Cache for 1 hour
    await redisClient.setex(cacheKey, 3600, JSON.stringify(response));

    res.json(response);
  } catch (error) {
    throw new Error(error);
  }
});

/**
 * @function trackProductView
 * @description Track product view for analytics
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.id - Product ID
 * @returns {Object} - Success message
 */
const trackProductView = asyncHandler(async (req, res) => {
  const { id } = req.params;

  try {
    // Increment view count
    await Product.findByIdAndUpdate(id, { $inc: { views: 1 } });

    // Track in analytics
    await redisClient.lPush(
      "product_views",
      JSON.stringify({
        productId: id,
        timestamp: new Date(),
        userAgent: req.get("User-Agent"),
        ip: req.ip,
      }),
    );

    res.json({
      success: true,
      message: "View tracked successfully",
    });
  } catch (error) {
    throw new Error(error);
  }
});

// ── Product Reviews ────────────────────────────────────────────────────────

const REVIEW_TTL = 120; // 2 minutes — short so new reviews surface quickly

const SORT_OPTIONS = {
  recent:   { createdAt: -1 },
  helpful:  { helpful: -1, createdAt: -1 },
  highest:  { rating: -1,  createdAt: -1 },
  lowest:   { rating: 1,   createdAt: -1 },
};

/**
 * @function getProductReviews
 * @description Paginated reviews for a product with per-star breakdown.
 * @route GET /api/product/:id/reviews
 * @query {number} [page=1]
 * @query {number} [limit=10]  max 20
 * @query {string} [sort=recent]  recent | helpful | highest | lowest
 */
const getProductReviews = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const page     = Math.max(1, parseInt(req.query.page)  || 1);
  const limit    = Math.min(20, parseInt(req.query.limit) || 10);
  const sortKey  = SORT_OPTIONS[req.query.sort] ? req.query.sort : "recent";
  const sortOpt  = SORT_OPTIONS[sortKey];
  const skip     = (page - 1) * limit;

  const cacheKey = `product:reviews:${id}:${page}:${limit}:${sortKey}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  const productObjId = new mongoose.Types.ObjectId(id);

  const [reviews, total, breakdownRaw] = await Promise.all([
    ProductReview.find({ product: id, status: "active" })
      .sort(sortOpt)
      .skip(skip)
      .limit(limit)
      .populate("user", "firstname lastname image")
      .select("-__v -order")
      .lean(),

    ProductReview.countDocuments({ product: id, status: "active" }),

    // Star distribution: count of 1★ … 5★
    ProductReview.aggregate([
      { $match: { product: productObjId, status: "active" } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const b of breakdownRaw) breakdown[b._id] = b.count;

  const totalPages = Math.ceil(total / limit);
  const payload = {
    success: true,
    data: {
      reviews,
      breakdown,
      pagination: {
        currentPage: page,
        totalPages,
        totalResults: total,
        hasNext:  page < totalPages,
        hasPrev:  page > 1,
      },
    },
  };

  try {
    await redisClient.setex(cacheKey, REVIEW_TTL, JSON.stringify(payload));
  } catch (_) {}

  res.json(payload);
});

/**
 * @function createProductReview
 * @description Create or update the authenticated user's review for a product.
 *              Requires a verified purchase (a Delivered order containing this product).
 * @route POST /api/product/:id/reviews
 * @body  {number} rating   1–5 (required)
 * @body  {string} [comment]  max 1000 chars
 */
const createProductReview = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const { rating, comment } = req.body;
  const userId = req.user._id;

  if (!rating || !Number.isInteger(Number(rating)) || rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: "rating must be an integer between 1 and 5" });
  }
  if (comment !== undefined && typeof comment !== "string") {
    return res.status(400).json({ success: false, message: "comment must be a string" });
  }

  // ── Purchase verification: must have a Delivered order with this product ──
  const verifyingOrder = await Order.findOne({
    orderedBy:   userId,
    orderStatus: "delivered",
    "products.product": new mongoose.Types.ObjectId(id),
  }).select("_id").lean();

  if (!verifyingOrder) {
    return res.status(403).json({
      success: false,
      message: "You can only review products you have purchased and received",
    });
  }

  // ── Upsert: one review per user per product ────────────────────────────
  const review = await ProductReview.findOneAndUpdate(
    { product: id, user: userId },
    {
      order:               verifyingOrder._id,
      rating:              Number(rating),
      comment:             comment?.trim() || "",
      isVerifiedPurchase:  true,
      status:              "active",
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );

  // Invalidate page-1 cache for all sort orders (most common landing)
  const sorts = Object.keys(SORT_OPTIONS);
  try {
    await Promise.all(
      sorts.map((s) => redisClient.del(`product:reviews:${id}:1:10:${s}`)),
    );
  } catch (_) {}

  res.status(201).json({ success: true, data: review });
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
  getProductCategories,
  getSpecSchemas,
  getProducts,
  getPersonalizedSuggestions,
  getTrendingProducts,
  getCategorySuggestions,
  trackProductView,
  getProductReviews,
  createProductReview,
};
