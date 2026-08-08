/**
 * @file productVariants.js
 * @description Validation and derivation for multiple-version ("variable")
 *   products — the second branch of the add-product chooser, where one listing
 *   covers several versions that differ by size, colour, type, and so on.
 *
 * Shape:
 *   optionTypes  the axes the product varies along, each with its allowed values
 *                  [{ name: "Size",  values: ["40","41","42"] },
 *                   { name: "Color", values: ["Black","White"] }]
 *   variants     one entry per version actually for sale, with its own price,
 *                stock, SKU and image
 *                  [{ sku, price, quantity, image,
 *                     options: [{ name: "Size", value: "41" },
 *                               { name: "Color", value: "Black" }] }]
 *
 * A seller does not have to list every combination — 3 sizes × 2 colours allows
 * up to 6 variants, but selling only 4 of them is normal and permitted. What is
 * not permitted is a variant that names an option value outside optionTypes, or
 * two variants covering the same combination.
 *
 * Derived top-level fields. `price`, `listedPrice` and `quantity` stay populated
 * on a variable product — price/listedPrice from the cheapest variant ("from
 * ₦X"), quantity as the total across variants. Every existing reader (search,
 * sort, cart, stock checks, the order pipeline) keys off those fields, so
 * deriving them keeps variable products working everywhere without touching
 * those code paths.
 */

const money = require("./money");

const MAX_OPTION_TYPES = 3;
const MAX_OPTION_VALUES = 20;
const MAX_VARIANTS = 100;

// Platform margin, matching the single-product path in the product controller.
const COMMISSION_PERCENT = 2;

/** Listed (customer-facing) price for a seller's price. */
const listedPriceFor = (sellersPrice) =>
  money.add(sellersPrice, money.percentage(sellersPrice, COMMISSION_PERCENT));

/** Stable key for a combination, order-independent so option order cannot create a false duplicate. */
const combinationKey = (options) =>
  options
    .map((o) => `${o.name.toLowerCase()}=${o.value.toLowerCase()}`)
    .sort()
    .join("|");

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/**
 * Validate optionTypes and variants together.
 *
 * @param {Object} input
 * @param {Array}  input.optionTypes
 * @param {Array}  input.variants
 * @returns {{ errors: string[], optionTypes: Array, variants: Array, derived: Object }}
 */
const validateVariants = ({ optionTypes, variants }) => {
  const errors = [];

  // ── optionTypes ───────────────────────────────────────────────────────────
  if (!Array.isArray(optionTypes) || optionTypes.length === 0) {
    return {
      errors: [
        'optionTypes is required for a multiple-version product, e.g. [{ "name": "Size", "values": ["40","41"] }]',
      ],
      optionTypes: [],
      variants: [],
      derived: {},
    };
  }

  if (optionTypes.length > MAX_OPTION_TYPES) {
    errors.push(`A product may vary along at most ${MAX_OPTION_TYPES} option types`);
  }

  const cleanTypes = [];
  const seenTypeNames = new Set();

  for (const type of optionTypes) {
    if (!isNonEmptyString(type?.name)) {
      errors.push("Each option type needs a non-empty name, e.g. \"Size\"");
      continue;
    }
    const name = type.name.trim();
    const lower = name.toLowerCase();

    if (seenTypeNames.has(lower)) {
      errors.push(`Duplicate option type '${name}'`);
      continue;
    }
    seenTypeNames.add(lower);

    if (!Array.isArray(type.values) || type.values.length === 0) {
      errors.push(`Option type '${name}' needs at least one value`);
      continue;
    }
    if (type.values.length > MAX_OPTION_VALUES) {
      errors.push(`Option type '${name}' may have at most ${MAX_OPTION_VALUES} values`);
      continue;
    }

    const values = [];
    const seenValues = new Set();
    let badValue = false;

    for (const value of type.values) {
      if (!isNonEmptyString(value)) {
        errors.push(`Option type '${name}' has an empty value`);
        badValue = true;
        break;
      }
      const trimmed = value.trim();
      const key = trimmed.toLowerCase();
      if (seenValues.has(key)) {
        errors.push(`Option type '${name}' has duplicate value '${trimmed}'`);
        badValue = true;
        break;
      }
      seenValues.add(key);
      values.push(trimmed);
    }

    if (!badValue) cleanTypes.push({ name, values });
  }

  // ── variants ──────────────────────────────────────────────────────────────
  if (!Array.isArray(variants) || variants.length === 0) {
    errors.push("variants is required for a multiple-version product, with at least one entry");
    return { errors, optionTypes: cleanTypes, variants: [], derived: {} };
  }

  if (variants.length > MAX_VARIANTS) {
    errors.push(`A product may have at most ${MAX_VARIANTS} variants`);
  }

  // Lookup of allowed values per option type, for membership checks.
  const allowed = new Map(
    cleanTypes.map((t) => [
      t.name.toLowerCase(),
      new Set(t.values.map((v) => v.toLowerCase())),
    ]),
  );

  const cleanVariants = [];
  const seenCombinations = new Set();
  const seenSkus = new Set();

  variants.forEach((variant, index) => {
    const label = `Variant ${index + 1}`;

    if (!variant || typeof variant !== "object") {
      errors.push(`${label} must be an object`);
      return;
    }

    // Price / quantity — same rules as a single-version product.
    if (!Number.isFinite(Number(variant.price)) || Number(variant.price) <= 0) {
      errors.push(`${label}: price must be a number greater than 0`);
      return;
    }
    if (!Number.isInteger(Number(variant.quantity)) || Number(variant.quantity) < 0) {
      errors.push(`${label}: quantity must be an integer of 0 or more`);
      return;
    }

    // Options must name every declared type exactly once, with an allowed value.
    if (!Array.isArray(variant.options) || variant.options.length === 0) {
      errors.push(`${label}: options is required, e.g. [{ "name": "Size", "value": "41" }]`);
      return;
    }

    const options = [];
    const namedTypes = new Set();
    let badOption = false;

    for (const option of variant.options) {
      if (!isNonEmptyString(option?.name) || !isNonEmptyString(option?.value)) {
        errors.push(`${label}: each option needs a name and a value`);
        badOption = true;
        break;
      }
      const name = option.name.trim();
      const value = option.value.trim();
      const typeKey = name.toLowerCase();

      if (!allowed.has(typeKey)) {
        errors.push(`${label}: '${name}' is not one of the product's option types`);
        badOption = true;
        break;
      }
      if (namedTypes.has(typeKey)) {
        errors.push(`${label}: '${name}' is given more than once`);
        badOption = true;
        break;
      }
      if (!allowed.get(typeKey).has(value.toLowerCase())) {
        errors.push(
          `${label}: '${value}' is not a declared value of option type '${name}'`,
        );
        badOption = true;
        break;
      }

      namedTypes.add(typeKey);
      options.push({ name, value });
    }

    if (badOption) return;

    // Every declared axis must be pinned, or the variant is ambiguous — a
    // "Size 41" variant on a size×colour product does not identify a version.
    const missing = cleanTypes
      .filter((t) => !namedTypes.has(t.name.toLowerCase()))
      .map((t) => t.name);
    if (missing.length) {
      errors.push(`${label}: missing a value for option type(s): ${missing.join(", ")}`);
      return;
    }

    const key = combinationKey(options);
    if (seenCombinations.has(key)) {
      errors.push(
        `${label}: duplicates an earlier variant (${options
          .map((o) => `${o.name} ${o.value}`)
          .join(", ")})`,
      );
      return;
    }
    seenCombinations.add(key);

    if (variant.sku !== undefined && variant.sku !== null && String(variant.sku).trim() !== "") {
      const sku = String(variant.sku).trim();
      if (seenSkus.has(sku.toLowerCase())) {
        errors.push(`${label}: SKU '${sku}' is used by another variant of this product`);
        return;
      }
      seenSkus.add(sku.toLowerCase());
      variant = { ...variant, sku };
    }

    const sellersPrice = money.round(Number(variant.price));

    cleanVariants.push({
      ...(variant.sku ? { sku: String(variant.sku).trim() } : {}),
      price: sellersPrice,
      listedPrice: listedPriceFor(sellersPrice),
      quantity: Number(variant.quantity),
      sold: 0,
      ...(isNonEmptyString(variant.image) ? { image: variant.image.trim() } : {}),
      options,
    });
  });

  if (errors.length) {
    return { errors, optionTypes: cleanTypes, variants: cleanVariants, derived: {} };
  }

  return {
    errors,
    optionTypes: cleanTypes,
    variants: cleanVariants,
    derived: deriveTopLevel(cleanVariants),
  };
};

/**
 * Top-level price/listedPrice/quantity for a variable product.
 * Price is the cheapest variant (the "from ₦X" figure); quantity is the total
 * across variants, so an out-of-stock check on the parent still works.
 */
const deriveTopLevel = (variants) => {
  const prices = variants.map((v) => v.price);
  const price = money.min(...prices);
  return {
    price,
    listedPrice: listedPriceFor(price),
    quantity: variants.reduce((sum, v) => sum + v.quantity, 0),
  };
};

module.exports = {
  validateVariants,
  deriveTopLevel,
  listedPriceFor,
  combinationKey,
  MAX_OPTION_TYPES,
  MAX_OPTION_VALUES,
  MAX_VARIANTS,
};
