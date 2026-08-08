/**
 * @file productSpecs.js
 * @description Category-specific product specification schemas — the "Product
 *   Specification" step (3/3) of the add-product flow, which only appears for
 *   categories that declare a `specSchema`.
 *
 * SINGLE SOURCE OF TRUTH for those field sets. The same definitions drive:
 *   - server-side validation on create/update,
 *   - `GET /api/product/spec-schemas`, which the client renders the form from
 *     (labels, placeholders, and dropdown options all come from here).
 *
 * Serving the dropdown options rather than hardcoding them in the app means a
 * new RAM size or warranty term ships without an app release.
 *
 * Which fields are required: only the ones a buyer actually filters or searches
 * on. The design marks nearly everything mandatory, but a seller who cannot
 * recall their phone's exact display resolution must still be able to publish —
 * blocking on the long tail costs listings, not data quality. Tightening later
 * is additive; loosening after sellers have hit the wall is not.
 *
 * Specs are persisted in the Product model's existing `specifications` array as
 * `{ key, value }` pairs, where `key` is the camelCase `id` below. That keeps
 * every existing reader working — see toSpecificationPairs / fromSpecificationPairs.
 */

const TEXT = "text";
const SELECT = "select";

/**
 * Field definition:
 *   id          camelCase key persisted in specifications[].key
 *   label       form label shown to the seller
 *   type        text | select
 *   required    whether create/update rejects the product without it
 *   placeholder example text shown in the empty input
 *   options     allowed values (select only); free text is rejected
 */
const SPEC_SCHEMAS = {
  phone: {
    key: "phone",
    label: "Phone & Tablet",
    description:
      "Specifications for phones, tablets and their accessories. Shown when the product's category (or its parent) declares the `phone` spec schema.",
    fields: [
      {
        id: "operatingSystem",
        label: "Operating System",
        type: TEXT,
        required: true,
        placeholder: "e.g. Android 13, iOS 17",
      },
      {
        id: "processorType",
        label: "Processor Type",
        type: TEXT,
        required: false,
        placeholder: "e.g. MediaTek Helio G99",
      },
      {
        id: "ramSize",
        label: "RAM Size (Memory)",
        type: SELECT,
        required: true,
        placeholder: "e.g. 6GB",
        options: ["1GB", "2GB", "3GB", "4GB", "6GB", "8GB", "12GB", "16GB", "18GB", "24GB"],
      },
      {
        id: "romSize",
        label: "ROM (Internal Storage)",
        type: SELECT,
        required: true,
        placeholder: "e.g. 128GB",
        options: ["8GB", "16GB", "32GB", "64GB", "128GB", "256GB", "512GB", "1TB"],
      },
      {
        id: "displayResolution",
        label: "Display Resolution",
        type: TEXT,
        required: false,
        placeholder: "e.g. 1080 x 2400 pixels",
      },
      {
        id: "screenSize",
        label: "Screen Size (inches)",
        type: TEXT,
        required: true,
        placeholder: "e.g. 6.5",
      },
      {
        id: "cameraSpecs",
        label: "Camera Specs",
        type: SELECT,
        required: false,
        placeholder: "e.g. 64MP Rear + 16MP Front",
        options: [
          "8MP Rear + 5MP Front",
          "13MP Rear + 8MP Front",
          "16MP Rear + 8MP Front",
          "32MP Rear + 13MP Front",
          "48MP Rear + 16MP Front",
          "64MP Rear + 16MP Front",
          "108MP Rear + 32MP Front",
          "200MP Rear + 32MP Front",
        ],
      },
      {
        id: "batteryCapacity",
        label: "Battery Capacity",
        type: SELECT,
        required: true,
        placeholder: "e.g. 5000 mAh",
        options: [
          "2000 mAh",
          "3000 mAh",
          "4000 mAh",
          "4500 mAh",
          "5000 mAh",
          "6000 mAh",
          "7000 mAh",
          "10000 mAh",
        ],
      },
      {
        id: "networkType",
        label: "Network Type",
        type: SELECT,
        required: false,
        placeholder: "e.g. 4G LTE, 5G",
        options: ["2G", "3G", "4G LTE", "5G", "WiFi only"],
      },
      {
        id: "simConfiguration",
        label: "SIM Configuration",
        type: SELECT,
        required: false,
        placeholder: "e.g. Dual Nano SIM",
        options: [
          "Single SIM",
          "Dual SIM",
          "Single Nano SIM",
          "Dual Nano SIM",
          "Nano SIM + eSIM",
          "eSIM only",
        ],
      },
      {
        id: "dimensions",
        label: "Dimensions (L × W × H in mm)",
        type: TEXT,
        required: false,
        placeholder: "e.g. 160 x 75 x 8 mm",
      },
    ],
  },

  computer: {
    key: "computer",
    label: "Computers & Accessories",
    description:
      "Specifications for laptops, desktops and computer accessories. Shown when the product's category (or its parent) declares the `computer` spec schema.",
    fields: [
      {
        id: "operatingSystem",
        label: "Operating System",
        type: TEXT,
        required: true,
        placeholder: "e.g. Windows 11, macOS Ventura",
      },
      {
        id: "processorCpu",
        label: "Processor (CPU)",
        type: TEXT,
        required: true,
        placeholder: "e.g. Intel Core i5, AMD Ryzen 7",
      },
      {
        id: "ramSize",
        label: "RAM Size (Memory)",
        type: SELECT,
        required: true,
        placeholder: "e.g. 8GB",
        options: ["2GB", "4GB", "8GB", "12GB", "16GB", "24GB", "32GB", "64GB", "128GB"],
      },
      {
        id: "romStorage",
        label: "ROM (Storage Capacity)",
        type: SELECT,
        required: true,
        placeholder: "e.g. 512GB SSD, 1TB HDD",
        options: [
          "128GB SSD",
          "256GB SSD",
          "512GB SSD",
          "1TB SSD",
          "2TB SSD",
          "500GB HDD",
          "1TB HDD",
          "2TB HDD",
        ],
      },
      {
        id: "modelYear",
        label: "Model Year",
        type: SELECT,
        required: false,
        placeholder: "e.g. 2023",
        options: buildYearOptions(),
      },
      {
        id: "graphicsCard",
        label: "Graphics Card",
        type: TEXT,
        required: false,
        placeholder: "e.g. NVIDIA GTX 1650, Integrated Intel Iris",
      },
      {
        id: "displayResolution",
        label: "Display Resolution",
        type: TEXT,
        required: false,
        placeholder: "e.g. 1920 x 1080 pixels (Full HD)",
      },
      {
        id: "batteryLife",
        label: "Battery Life (Laptops Only)",
        type: TEXT,
        required: false,
        placeholder: "e.g. Up to 8 hours",
      },
      {
        id: "usbPorts",
        label: "USB Ports",
        type: SELECT,
        required: false,
        placeholder: "e.g. 2 x USB 3.0, 1 x USB-C",
        options: [
          "1 x USB 2.0",
          "2 x USB 2.0",
          "1 x USB 3.0",
          "2 x USB 3.0",
          "3 x USB 3.0",
          "1 x USB-C",
          "2 x USB-C",
          "2 x USB 3.0, 1 x USB-C",
          "2 x USB 3.0, 2 x USB-C",
          "None",
        ],
      },
      {
        id: "connectivityFeatures",
        label: "Connectivity Features",
        type: SELECT,
        required: false,
        placeholder: "e.g. Bluetooth 5.0, WiFi 6",
        options: [
          "WiFi 5",
          "WiFi 6",
          "WiFi 6E",
          "Bluetooth 4.2",
          "Bluetooth 5.0",
          "Bluetooth 5.3",
          "Bluetooth 5.0, WiFi 6",
          "Bluetooth 5.3, WiFi 6E",
          "Ethernet",
        ],
      },
      {
        id: "screenSize",
        label: "Screen Size (inches)",
        type: TEXT,
        required: true,
        placeholder: "e.g. 15.6",
      },
      {
        id: "dimensions",
        label: "Dimensions (L x W x H in mm)",
        type: TEXT,
        required: false,
        placeholder: "e.g. 365 x 250 x 20 mm",
      },
    ],
  },
};

/** Model years, newest first — regenerated per process so the list never goes stale. */
function buildYearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 15 }, (_, i) => String(current - i));
}

/**
 * Warranty is appended to every schema. It is the one part of the spec screen
 * the design itself marks optional, and the fields are identical across
 * categories, so it lives here rather than being repeated per schema.
 */
const WARRANTY_FIELDS = [
  {
    id: "warrantyType",
    label: "Warranty Type",
    type: SELECT,
    required: false,
    placeholder: "Specify if the product comes with a warranty.",
    options: [
      "No Warranty",
      "Seller Warranty",
      "Manufacturer Warranty",
      "International Warranty",
    ],
  },
  {
    id: "warrantyDuration",
    label: "Warranty Duration",
    type: SELECT,
    required: false,
    placeholder: "e.g. 1 Year",
    options: [
      "1 Month",
      "3 Months",
      "6 Months",
      "1 Year",
      "2 Years",
      "3 Years",
      "5 Years",
    ],
  },
];

const SPEC_SCHEMA_KEYS = Object.keys(SPEC_SCHEMAS);

/** Full field list for a schema, warranty included. */
const fieldsFor = (schemaKey) => {
  const schema = SPEC_SCHEMAS[schemaKey];
  if (!schema) return null;
  return [...schema.fields, ...WARRANTY_FIELDS];
};

/** Schema definition shaped for the client form renderer. */
const describeSchema = (schemaKey) => {
  const schema = SPEC_SCHEMAS[schemaKey];
  if (!schema) return null;
  return {
    key: schema.key,
    label: schema.label,
    description: schema.description,
    fields: fieldsFor(schemaKey),
  };
};

const describeAllSchemas = () => SPEC_SCHEMA_KEYS.map(describeSchema);

/**
 * Validate a submitted specifications object against a category's spec schema.
 *
 * Accepts the keyed object the form produces:
 *   { operatingSystem: "Android 13", ramSize: "6GB", ... }
 *
 * @param {string} schemaKey - "phone" | "computer"
 * @param {Object} input     - Submitted specifications
 * @param {Object} [opts]
 * @param {boolean} [opts.partial=false] - Skip required checks (for PATCH-style updates)
 * @returns {{ errors: string[], values: Object }}
 */
const validateSpecifications = (schemaKey, input, { partial = false } = {}) => {
  const fields = fieldsFor(schemaKey);
  if (!fields) {
    return { errors: [`Unknown specification schema '${schemaKey}'`], values: {} };
  }

  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      errors: [
        "specifications must be an object keyed by field id, e.g. { operatingSystem: \"Android 13\" }",
      ],
      values: {},
    };
  }

  const errors = [];
  const values = {};
  const known = new Set(fields.map((f) => f.id));

  // Reject unknown keys rather than silently dropping them — a typo'd field id
  // would otherwise look like it saved and quietly vanish from the listing.
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      errors.push(
        `Unknown specification '${key}' for the ${schemaKey} schema. Allowed: ${[...known].join(", ")}`,
      );
    }
  }

  for (const field of fields) {
    const raw = input[field.id];
    const provided = raw !== undefined && raw !== null && String(raw).trim() !== "";

    if (!provided) {
      if (field.required && !partial) {
        errors.push(`${field.label} is required`);
      }
      continue;
    }

    const value = String(raw).trim();

    if (field.type === SELECT && Array.isArray(field.options) && !field.options.includes(value)) {
      errors.push(
        `${field.label} must be one of: ${field.options.join(", ")} (got "${value}")`,
      );
      continue;
    }

    values[field.id] = value;
  }

  return { errors, values };
};

/**
 * Convert a validated specifications object into the Product model's
 * `specifications: [{ key, value }]` array.
 *
 * Field order follows the schema, not the object's insertion order, so the
 * product detail screen renders specs in the same order the form collected them
 * regardless of how the client serialized its payload.
 */
const toSpecificationPairs = (schemaKey, values) => {
  const fields = fieldsFor(schemaKey);
  if (!fields) return [];
  return fields
    .filter((f) => values[f.id] !== undefined)
    .map((f) => ({ key: f.id, value: values[f.id] }));
};

/** Inverse of toSpecificationPairs — the keyed object clients prefer to read. */
const fromSpecificationPairs = (pairs) => {
  const out = {};
  for (const pair of pairs || []) {
    if (pair?.key) out[pair.key] = pair.value;
  }
  return out;
};

/** Human label for a spec field id, for rendering stored pairs. */
const labelFor = (schemaKey, fieldId) => {
  const fields = fieldsFor(schemaKey) || [];
  return fields.find((f) => f.id === fieldId)?.label || fieldId;
};

module.exports = {
  SPEC_SCHEMAS,
  SPEC_SCHEMA_KEYS,
  WARRANTY_FIELDS,
  fieldsFor,
  describeSchema,
  describeAllSchemas,
  validateSpecifications,
  toSpecificationPairs,
  fromSpecificationPairs,
  labelFor,
};
