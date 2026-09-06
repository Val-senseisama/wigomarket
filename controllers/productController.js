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
const {
  validateVariants,
  listedPriceFor,
  combinationKey,
} = require("../utils/productVariants");

// Stored shelf visibility. Mirrors productModel.status — "out of stock" is a
// derived display state, not a value a client can set.
const PRODUCT_STATUSES = ["active", "hidden"];
const Store = require("../models/storeModel");
const { listProducts } = require("../services/productQueryService");
const { serializeProductDetail } = require("../utils/productSerializer");
const Wishlist = require("../models/wishlistModel");

// How a buyer can receive a product. Mirrors productModel.availableFor.
const FULFILMENT_OPTIONS = ["delivery", "pickup"];

/**
 * Validate the availableFor list from a create/update body.
 * @returns {{ error?: string, availableFor?: string[] }}
 */
const validateAvailableFor = (availableFor) => {
  if (availableFor === undefined) return { availableFor: undefined };
  if (!Array.isArray(availableFor) || availableFor.length === 0) {
    return {
      error: `availableFor must be a non-empty array containing any of: ${FULFILMENT_OPTIONS.join(", ")}`,
    };
  }
  const bad = availableFor.filter((v) => !FULFILMENT_OPTIONS.includes(v));
  if (bad.length) {
    return { error: `availableFor may only contain: ${FULFILMENT_OPTIONS.join(", ")}` };
  }
  // De-duplicate — ["delivery","delivery"] is a client bug, not a new option.
  return { availableFor: [...new Set(availableFor)] };
};
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
    // Public listing — a hidden product is off the storefront entirely.
    const products = await Product.find({
      category: categoryId,
      status: { $ne: "hidden" },
    }).populate("store", "name image mobile address"); // Find products by category ID
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

  // Shelf visibility. Defaults to active; "hidden" lets a seller stage a
  // product without it appearing on the storefront.
  const status = req.body.status || "active";
  if (!PRODUCT_STATUSES.includes(status)) {
    return invalid(res, `status must be one of: ${PRODUCT_STATUSES.join(", ")}`);
  }

  // How the buyer can receive it — "Available for: Delivery & Pick-up".
  const fulfilment = validateAvailableFor(req.body.availableFor);
  if (fulfilment.error) return invalid(res, fulfilment.error);

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
      ...(fulfilment.availableFor && { availableFor: fulfilment.availableFor }),
      status,
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
          status,
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

  // Load first: what may be edited depends on the product — a variable product
  // is priced and stocked per variant, a single one is not — and the load
  // doubles as the ownership check. A seller may only edit their own products,
  // and a product id alone must never be enough to change one.
  const existing = await Product.findOne({ _id: id, store: req.store }).lean();
  if (!existing) {
    return res.status(404).json({
      success: false,
      message: "Product not found in your store",
    });
  }

  const isVariable = existing.productType === "variable";

  if (req.body.title       && !Validate.string(req.body.title))       ThrowError("Invalid Title");
  if (req.body.brand       && !Validate.string(req.body.brand))       ThrowError("Invalid Brand");
  if (req.body.description && !Validate.string(req.body.description)) ThrowError("Invalid Description");
  if (req.body.status !== undefined && !PRODUCT_STATUSES.includes(req.body.status)) {
    return invalid(res, `status must be one of: ${PRODUCT_STATUSES.join(", ")}`);
  }

  // A product cannot change shape after creation: turning a single product into
  // a variable one (or back) would leave existing carts and orders pointing at
  // a pricing model that no longer exists.
  if (req.body.productType !== undefined && req.body.productType !== existing.productType) {
    return invalid(
      res,
      `productType cannot be changed after creation (this product is "${existing.productType}") — create a new product instead`,
    );
  }

  // Whitelist — callers cannot overwrite internal or derived fields (sold,
  // views, store, rating, slug, listedPrice).
  // `status` is the hide/unhide toggle on the product card; "out of stock" is
  // never set here, it follows from quantity.
  const ALLOWED = [
    "title", "price", "quantity", "category", "brand", "description",
    "images", "video", "sku", "tags", "isFeatured", "status", "availableFor",
    "specifications", "sizes", "colors", "optionTypes", "variants",
  ];
  const updateData = {};
  for (const field of ALLOWED) {
    if (req.body[field] !== undefined) updateData[field] = req.body[field];
  }

  if (Object.keys(updateData).length === 0) {
    return res.status(400).json({ success: false, message: "No valid fields to update" });
  }

  // ── Pricing & stock ──────────────────────────────────────────────────────
  if (isVariable) {
    if (updateData.price !== undefined || updateData.quantity !== undefined) {
      return invalid(
        res,
        "This is a multiple-version product: price and quantity are derived from its variants — send `variants` instead",
      );
    }
  } else {
    if (updateData.optionTypes !== undefined || updateData.variants !== undefined) {
      return invalid(
        res,
        'optionTypes and variants only apply to a multiple-version product — this product is "single"',
      );
    }
    if (updateData.price !== undefined && (!Validate.float(updateData.price) || updateData.price <= 0)) {
      ThrowError("Invalid Price");
    }
    if (updateData.quantity !== undefined && (!Validate.integer(updateData.quantity) || updateData.quantity < 0)) {
      ThrowError("Invalid Quantity");
    }
    // Recompute listedPrice when price changes.
    if (updateData.price !== undefined) {
      updateData.price = money.round(updateData.price);
      updateData.listedPrice = listedPriceFor(updateData.price);
    }
  }

  // ── Variants — the "Edit Variant" table ──────────────────────────────────
  if (updateData.variants !== undefined || updateData.optionTypes !== undefined) {
    // Either may be sent alone: repricing a variant does not touch the axes,
    // and adding an option value does not touch the rows.
    const result = validateVariants({
      optionTypes: updateData.optionTypes ?? existing.optionTypes,
      variants: updateData.variants ?? existing.variants,
    });
    if (result.errors.length) {
      return invalid(res, "Invalid product versions", result.errors);
    }

    // validateVariants zeroes `sold` — it is written for creation. Carry the
    // real figures across by option combination, so repricing a variant does
    // not erase its sales history.
    const soldByCombination = new Map(
      (existing.variants || []).map((v) => [combinationKey(v.options || []), v.sold || 0]),
    );

    updateData.optionTypes = result.optionTypes;
    updateData.variants = result.variants.map((variant) => ({
      ...variant,
      sold: soldByCombination.get(combinationKey(variant.options)) || 0,
    }));

    // Top-level price/quantity stay derived — search, sort, cart, stock checks
    // and the order pipeline all key off them.
    updateData.price = result.derived.price;
    updateData.listedPrice = result.derived.listedPrice;
    updateData.quantity = result.derived.quantity;
  }

  // ── Media ────────────────────────────────────────────────────────────────
  if (updateData.images !== undefined) {
    const imageResult = validateImages(updateData.images);
    if (imageResult.error) {
      return invalid(res, imageResult.error, imageResult.invalidUrls);
    }
    updateData.images = imageResult.images;
  }

  if (updateData.video !== undefined) {
    // null or "" removes the video.
    if (updateData.video === null || String(updateData.video).trim() === "") {
      updateData.video = null;
    } else if (!Validate.cloudinaryUrl(updateData.video)) {
      return invalid(
        res,
        "video must be a valid Cloudinary URL. Upload via POST /api/upload/signature (folder: products).",
      );
    } else {
      updateData.video = String(updateData.video).trim();
    }
  }

  // ── Fulfilment ───────────────────────────────────────────────────────────
  const fulfilment = validateAvailableFor(updateData.availableFor);
  if (fulfilment.error) return invalid(res, fulfilment.error);
  if (fulfilment.availableFor !== undefined) updateData.availableFor = fulfilment.availableFor;

  // ── Category ─────────────────────────────────────────────────────────────
  if (updateData.category !== undefined) {
    validateMongodbId(updateData.category);
    const categoryExists = await Category.exists({ _id: updateData.category });
    if (!categoryExists) {
      return res.status(404).json({ success: false, message: "Category not found" });
    }
  }

  // ── SKU — unique within the store ────────────────────────────────────────
  let unset;
  if (updateData.sku !== undefined) {
    if (updateData.sku === null || String(updateData.sku).trim() === "") {
      // $unset rather than a null: the partial unique index only covers string
      // values, so a stored null would be a stray field.
      delete updateData.sku;
      unset = { sku: "" };
    } else {
      updateData.sku = String(updateData.sku).trim();
      const clash = await Product.exists({
        store: req.store,
        sku: updateData.sku,
        _id: { $ne: id },
      });
      if (clash) {
        return invalid(res, `SKU '${updateData.sku}' is already used by another product in your store`);
      }
    }
  }

  if (updateData.title) {
    updateData.slug = slugify(updateData.title);
  }

  try {
    const updatedProduct = await Product.findOneAndUpdate(
      { _id: id, store: req.store },
      { $set: updateData, ...(unset && { $unset: unset }) },
      { new: true, runValidators: true },
    )
      .populate("store", "name image mobile address")
      .populate({ path: "category", select: "name parent", populate: { path: "parent", select: "name" } })
      .lean();

    if (!updatedProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found in your store",
      });
    }

    audit.log({
      action: "product.updated",
      actor: audit.actor(req),
      resource: { type: "product", id, displayName: updatedProduct.title },
      changes: {
        before: { fieldsChanged: Object.keys(updateData).concat(unset ? ["sku"] : []) },
        after: updateData,
      },
    });

    res.json({
      success: true,
      // The same shape the product page reads, so a client can render the
      // result of an edit without re-fetching.
      data: serializeProductDetail(updatedProduct),
    });
  } catch (error) {
    // Last line of defence against two concurrent edits claiming one SKU.
    if (error?.code === 11000 && error?.keyPattern?.sku) {
      return invalid(res, `SKU '${updateData.sku}' is already used by another product in your store`);
    }
    throw new Error(error);
  }
});

/**
 * @function deleteProduct
 * @description Permanently delete one of the caller's own products, along with
 *   its reviews, and remove it from every cart and wishlist holding it.
 * @route DELETE /api/product/:id
 * @param {string} req.params.id - Product ID (required)
 * @returns {Object} - Deletion summary
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  // Scoped to the caller's own store. The previous version read `req.body.id`
  // (never sent — the id is a path param) and passed the bare value to
  // findOneAndDelete, which treats a non-object filter as {} and would delete
  // an arbitrary product from someone else's store.
  const product = await Product.findOneAndDelete({ _id: id, store: req.store });

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found in your store",
    });
  }

  await cleanUpDeletedProducts([product._id]);

  audit.log({
    action: "product.deleted",
    actor: audit.actor(req),
    resource: { type: "product", id, displayName: product.title },
    changes: { before: { title: product.title, sku: product.sku, status: product.status } },
  });

  res.json({
    success: true,
    message: "Product deleted successfully",
    data: { id: product._id, title: product.title },
  });
});

/**
 * Remove deleted products from everything that references them. Reviews go with
 * the product; carts and wishlists would otherwise keep a dangling row that
 * renders as an empty line item.
 *
 * Best-effort: the product is already gone, so a failure here must not turn a
 * successful delete into a 500. Failures are audited instead.
 *
 * @param {Array<mongoose.Types.ObjectId>} ids
 */
const cleanUpDeletedProducts = async (ids) => {
  try {
    await Promise.all([
      ProductReview.deleteMany({ product: { $in: ids } }),
      Cart.updateMany(
        { "products.product": { $in: ids } },
        { $pull: { products: { product: { $in: ids } } } },
      ),
      Wishlist.updateMany(
        { "products.product": { $in: ids } },
        { $pull: { products: { product: { $in: ids } } } },
      ),
    ]);
  } catch (error) {
    audit.log({
      action: "product.delete_cleanup_failed",
      resource: { type: "product", id: String(ids[0]) },
      changes: { after: { ids: ids.map(String), error: error.message } },
    });
  }
};

// Actions the seller's "Bulk action" menu can apply to a multi-select.
const BULK_ACTIONS = ["hide", "unhide", "delete"];
const MAX_BULK_IDS = 100;

/**
 * @function bulkUpdateProducts
 * @description Apply one action to several of the caller's own products at once
 *   — the "Bulk action" control above the product list.
 * @route POST /api/product/bulk
 * @param {string}   req.body.action - hide | unhide | delete
 * @param {string[]} req.body.ids    - Product ids, max 100
 * @returns {Object} - How many were affected, and which ids were skipped
 */
const bulkUpdateProducts = asyncHandler(async (req, res) => {
  const { action, ids } = req.body;

  if (!BULK_ACTIONS.includes(action)) {
    return invalid(res, `action must be one of: ${BULK_ACTIONS.join(", ")}`);
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return invalid(res, "ids must be a non-empty array of product ids");
  }
  if (ids.length > MAX_BULK_IDS) {
    return invalid(res, `A bulk action may cover at most ${MAX_BULK_IDS} products at a time`);
  }

  const malformed = ids.filter((id) => !mongoose.isValidObjectId(id));
  if (malformed.length) {
    return invalid(res, "Every id must be a valid product id", malformed);
  }

  // Only the caller's own products are ever touched. Ids that belong to another
  // store — or no longer exist — are reported back as skipped rather than
  // failing the whole batch, so one stale row in the grid cannot block the rest.
  const owned = await Product.find(
    { _id: { $in: ids }, store: req.store },
    "_id title status",
  ).lean();

  const ownedIds = owned.map((p) => p._id);
  const ownedSet = new Set(ownedIds.map(String));
  const skipped = ids.filter((id) => !ownedSet.has(String(id)));

  if (ownedIds.length === 0) {
    return res.status(404).json({
      success: false,
      message: "None of those products are in your store",
      data: { action, matched: 0, affected: 0, skipped },
    });
  }

  let affected = 0;

  if (action === "delete") {
    const result = await Product.deleteMany({ _id: { $in: ownedIds }, store: req.store });
    affected = result.deletedCount || 0;
    await cleanUpDeletedProducts(ownedIds);
  } else {
    const status = action === "hide" ? "hidden" : "active";
    const result = await Product.updateMany(
      { _id: { $in: ownedIds }, store: req.store },
      { $set: { status } },
    );
    // modifiedCount excludes products already in the target state; the seller
    // asked for a state, not a change, so report what now matches.
    affected = result.matchedCount ?? result.n ?? 0;
  }

  audit.log({
    action: `product.bulk_${action}`,
    actor: audit.actor(req),
    resource: { type: "product", id: String(ownedIds[0]) },
    changes: {
      after: {
        action,
        ids: ownedIds.map(String),
        affected,
        skipped: skipped.map(String),
      },
    },
  });

  res.json({
    success: true,
    message: `${affected} product${affected === 1 ? "" : "s"} ${action === "delete" ? "deleted" : `${action === "hide" ? "hidden" : "unhidden"}`}`,
    data: {
      action,
      matched: ownedIds.length,
      affected,
      // Ids that were not in the caller's store, or already gone.
      skipped,
    },
  });
});

/**
 * @function getAProduct
 * @description Full detail for one product — everything the product page
 *   renders: overview, every image and the video, description, pricing and
 *   inventory (including the variants table), and the rating summary.
 * @route GET /api/product/:id
 * @param {string} req.params.id - Product ID (required)
 * @returns {Object} - Serialized product detail
 */
const getAProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const product = await Product.findById(id)
    .populate("store", "name image mobile address")
    // The parent comes too, for the "Fashion > Men's Clothing" breadcrumb.
    .populate({ path: "category", select: "name parent", populate: { path: "parent", select: "name" } })
    .select("-__v")
    .lean();

  if (!product) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  // A hidden product is invisible to the storefront but must stay reachable by
  // its owner — the seller's edit screen loads it through this same route.
  // The route runs optionalAuthMiddleware, so req.user is set only when a
  // token was sent.
  const ownStore = req.user
    ? await Store.findOne({ owner: req.user._id }, "_id").lean()
    : null;
  const isOwner =
    Boolean(ownStore) &&
    String(product.store?._id || product.store) === String(ownStore._id);

  if (product.status === "hidden" && !isOwner) {
    return res.status(404).json({ success: false, message: "Product not found" });
  }

  const productObjId = new mongoose.Types.ObjectId(id);

  const [lastOrder, breakdownRaw] = await Promise.all([
    // "Last Ordered" on the inventory panel. Only the owner sees it — it is
    // sales data, not something the storefront should expose.
    isOwner
      ? Order.findOne({ "products.product": productObjId })
          .sort({ createdAt: -1 })
          .select("createdAt")
          .lean()
      : Promise.resolve(null),

    // Star distribution for the Rating & Reviews panel, so the page renders
    // without a second round trip to /:id/reviews.
    ProductReview.aggregate([
      { $match: { product: productObjId, status: "active" } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const b of breakdownRaw) breakdown[b._id] = b.count;

  // Increment view count (fire-and-forget, non-blocking). The seller opening
  // their own product does not count as a view.
  if (!isOwner) {
    Product.findByIdAndUpdate(id, { $inc: { views: 1 } }).catch(() => {});
  }

  const data = serializeProductDetail(product, {
    lastOrderedAt: lastOrder?.createdAt || null,
    reviews: {
      average: product.rating?.average ?? 0,
      count: product.rating?.count ?? 0,
      breakdown,
    },
  });

  res.json({
    success: true,
    // True when the caller owns this product — the client uses it to decide
    // whether to render the Edit / Delete / Hide controls.
    isOwner,
    data,
  });
});
/**
 * @function getAllProducts
 * @description Paginated product listing behind GET /api/product/get-products.
 *              Serves two callers from one query:
 *                • the public storefront — active, in-stock products only;
 *                • a signed-in seller with `mine=true` — their own products,
 *                  hidden and out-of-stock included, which is what the seller
 *                  dashboard's product grid renders.
 * @param {Object} req - Express request object
 * @param {string}  [req.query.search]      - Matches product name or SKU
 * @param {string}  [req.query.category]    - Category id
 * @param {string}  [req.query.store]       - Store id (public store page)
 * @param {string}  [req.query.brand]       - Brand, partial match
 * @param {string}  [req.query.status]      - active | out_of_stock | hidden | all
 * @param {number}  [req.query.minPrice]    - Minimum listed price
 * @param {number}  [req.query.maxPrice]    - Maximum listed price
 * @param {string}  [req.query.sort=newest] - newest | oldest | price_asc | price_desc |
 *                                            best_selling | top_rated | title_asc |
 *                                            title_desc | stock_asc | stock_desc
 * @param {boolean} [req.query.mine]        - Scope to the caller's own store
 * @param {boolean} [req.query.includeVariants] - Embed full variant lists
 * @param {number}  [req.query.page=1]      - Page number
 * @param {number}  [req.query.limit=30]    - Page size (max 100)
 * @returns {Object} - Serialized product cards, pagination and status counts
 */
const getAllProducts = asyncHandler(async (req, res) => {
  const mine = String(req.query.mine || "") === "true";

  let baseFilter = {};
  let includeHidden = false;
  let withCounts = false;

  if (mine) {
    // The route runs optionalAuthMiddleware, so an anonymous caller reaches
    // here with no req.user rather than being rejected at the door.
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Sign in to list your own products",
      });
    }

    const store = await Store.findOne({ owner: req.user._id }, "_id").lean();
    if (!store) {
      return res.status(404).json({
        success: false,
        message: "No store found for this account",
      });
    }

    baseFilter = { store: store._id };
    includeHidden = true; // it is their own shelf
    withCounts = true;    // drives the Status filter chips
  } else if (req.query.store) {
    validateMongodbId(req.query.store);
    baseFilter = { store: req.query.store };
    withCounts = true;
  }

  if (req.query.category) validateMongodbId(req.query.category);

  const { products, pagination, counts, appliedStatus } = await listProducts({
    baseFilter,
    query: req.query,
    includeHidden,
    withCounts,
    // The seller's grid needs per-variant stock; the storefront does not.
    includeVariants: mine || String(req.query.includeVariants || "") === "true",
  });

  res.json({
    success: true,
    data: products,
    pagination,
    counts,
    appliedStatus,
    // Legacy keys from the original response shape. Deprecated — read
    // `pagination` instead; kept so existing clients keep working.
    totalProducts: pagination.total,
    totalPages: pagination.pages,
    currentPage: pagination.page,
  });
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

    // Build filter object. Hidden products are excluded from every public
    // listing; sellers see their own through GET /api/product/get-products?mine=true.
    const filters = { status: { $ne: "hidden" } };
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
        status: { $ne: "hidden" },
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
      suggestions = await Product.find({
        quantity: { $gt: 0 },
        status: { $ne: "hidden" },
      })
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
      status: { $ne: "hidden" },
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
      status: { $ne: "hidden" },
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
 * Cache keys carry a per-product version counter, so posting a review
 * invalidates every cached page of every sort and star filter in one write.
 * Deleting keys individually could not cover the combinations.
 */
const reviewCacheVersion = async (productId) => {
  try {
    const version = await redisClient.get(`product:reviews:ver:${productId}`);
    return version || "0";
  } catch (_) {
    return "0";
  }
};

const bumpReviewCacheVersion = async (productId) => {
  try {
    await redisClient.incr(`product:reviews:ver:${productId}`);
  } catch (_) {}
};

/**
 * @function getProductReviews
 * @description Paginated reviews for a product with the per-star breakdown and
 *   average that the Rating & Reviews panel renders.
 * @route GET /api/product/:id/reviews
 * @query {number} [page=1]
 * @query {number} [limit=10]    max 20 — the panel shows 5 or 10 per page
 * @query {string} [sort=recent] recent | helpful | highest | lowest
 * @query {number} [rating]      1-5, to show only that star rating
 */
const getProductReviews = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const page     = Math.max(1, parseInt(req.query.page)  || 1);
  const limit    = Math.min(20, Math.max(1, parseInt(req.query.limit) || 10));
  const sortKey  = SORT_OPTIONS[req.query.sort] ? req.query.sort : "recent";
  const sortOpt  = SORT_OPTIONS[sortKey];
  const skip     = (page - 1) * limit;

  // Star filter — clicking a bar in the breakdown narrows the list to it.
  let starFilter = null;
  if (req.query.rating !== undefined && req.query.rating !== "") {
    const star = parseInt(req.query.rating, 10);
    if (!Number.isInteger(star) || star < 1 || star > 5) {
      return invalid(res, "rating must be an integer between 1 and 5");
    }
    starFilter = star;
  }

  const version  = await reviewCacheVersion(id);
  const cacheKey = `product:reviews:${id}:v${version}:${page}:${limit}:${sortKey}:${starFilter ?? "all"}`;

  try {
    const cached = await redisClient.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch (_) {}

  const productObjId = new mongoose.Types.ObjectId(id);
  const baseFilter = { product: id, status: "active" };
  const listFilter = starFilter ? { ...baseFilter, rating: starFilter } : baseFilter;

  const [reviews, total, breakdownRaw, product] = await Promise.all([
    ProductReview.find(listFilter)
      .sort(sortOpt)
      .skip(skip)
      .limit(limit)
      .populate("user", "firstname lastname image")
      .select("-__v -order")
      .lean(),

    ProductReview.countDocuments(listFilter),

    // Star distribution: count of 1★ … 5★. Always across every review, not
    // just the filtered slice — the bars must not collapse when one is picked.
    ProductReview.aggregate([
      { $match: { product: productObjId, status: "active" } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),

    Product.findById(id).select("rating").lean(),
  ]);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const b of breakdownRaw) breakdown[b._id] = b.count;

  const totalPages = Math.ceil(total / limit);
  const payload = {
    success: true,
    data: {
      // "4.5 / 5.0 (10 Reviews)" plus the bars, in one place.
      summary: {
        average: product?.rating?.average ?? 0,
        count: product?.rating?.count ?? 0,
        breakdown,
      },
      reviews,
      // Kept alongside summary.breakdown for clients written against the
      // original response shape.
      breakdown,
      appliedFilters: { sort: sortKey, rating: starFilter },
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

  // One counter bump retires every cached page, sort and star filter for this
  // product — the old per-key deletes only covered page 1 at limit 10.
  await bumpReviewCacheVersion(id);

  res.status(201).json({ success: true, data: review });
});

module.exports = {
  createProduct,
  getAProduct,
  getAllProducts,
  updateProduct,
  deleteProduct,
  bulkUpdateProducts,
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
