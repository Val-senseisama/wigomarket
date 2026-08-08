/**
 * Add-product flow tests — both branches of the product chooser, the
 * category-specific specification step, and the two-level category tree.
 *
 * Controllers are called directly with a stub req/res rather than through
 * supertest + app: the route layer is `authMiddleware, isSeller, createProduct`,
 * identical to every other seller endpoint, and all the risk is in validation.
 */

const mongoose = require("mongoose");
const {
  createProduct,
  createProductCategory,
  updateProductCategory,
  getProductCategories,
  getSpecSchemas,
} = require("../controllers/productController");
const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const Category = require("../models/categoryModel");

const makeRes = () => {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    return res;
  };
  return res;
};

/** Invoke an asyncHandler controller and surface anything it throws. */
const call = async (handler, req) => {
  const res = makeRes();
  let thrown;
  await handler({ body: {}, query: {}, params: {}, ...req }, res, (err) => {
    thrown = err;
  });
  if (thrown) throw thrown;
  return res;
};

let seq = 0;
const uniq = () => `${Date.now()}${++seq}`;

const makeStore = async () => {
  const n = uniq();
  return Store.create({
    name: `Product Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    email: `store-${n}@example.com`,
    owner: new mongoose.Types.ObjectId(),
    address: "1 Test Street",
    ownerNIN: n.slice(-11),
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
};

const makeCategory = (overrides = {}) =>
  Category.create({ name: `Category ${uniq()}`, ...overrides });

const IMAGE = "https://res.cloudinary.com/demo/image/upload/v1/products/main.jpg";
const IMAGE2 = "https://res.cloudinary.com/demo/image/upload/v1/products/side.jpg";
const VIDEO = "https://res.cloudinary.com/demo/video/upload/v1/products/demo.mp4";

const PHONE_SPECS = {
  operatingSystem: "Android 13",
  ramSize: "8GB",
  romSize: "256GB",
  screenSize: "6.6",
  batteryCapacity: "5000 mAh",
};

const create = (store, body) =>
  call(createProduct, { store: store._id, body, user: { _id: store.owner } });

describe("createProduct — single version", () => {
  it("creates a product and derives listedPrice with 2% commission", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "Wireless Bluetooth Speaker",
      sku: "SPK-001",
      category: category._id.toString(),
      price: 4500,
      quantity: 20,
      description: "Portable wireless speaker with 12-hour battery life.",
      images: [IMAGE, IMAGE2],
      video: VIDEO,
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.specSchema).toBeNull();

    const product = res.body.data;
    expect(product.productType).toBe("single");
    expect(product.sku).toBe("SPK-001");
    expect(product.price).toBe(4500);
    expect(product.listedPrice).toBe(4590); // 4500 + 2%
    expect(product.quantity).toBe(20);
    expect(product.images[0]).toBe(IMAGE); // main image first
    expect(product.video).toBe(VIDEO);
    expect(product.variants).toHaveLength(0);
  });

  it("does not require a brand", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "No Brand Item",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "The add-product form does not collect a brand.",
      images: [IMAGE],
    });

    expect(res.statusCode).toBe(201);
  });

  it("requires at least one image", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "No Images",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "Missing the required images array.",
      images: [],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/at least one product image/i);
  });

  it("rejects more than 5 images", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "Too Many Images",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "Six images is one too many.",
      images: Array(6).fill(IMAGE),
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/maximum of 5/i);
  });

  it("rejects a non-Cloudinary image URL", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "Bad Image Host",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "Images must be uploaded to Cloudinary first.",
      images: ["https://example.com/not-cloudinary.jpg"],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.invalidUrls || res.body.errors).toBeDefined();
  });

  it("rejects a duplicate SKU within the same store but allows it across stores", async () => {
    const storeA = await makeStore();
    const storeB = await makeStore();
    const category = await makeCategory();

    const body = {
      title: "SKU Product",
      sku: "DUP-001",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "Testing per-store SKU uniqueness.",
      images: [IMAGE],
    };

    expect((await create(storeA, body)).statusCode).toBe(201);

    const clash = await create(storeA, { ...body, title: "Another Product" });
    expect(clash.statusCode).toBe(400);
    expect(clash.body.message).toMatch(/already used/i);

    // A different seller may use the same code.
    expect((await create(storeB, body)).statusCode).toBe(201);
  });

  it("rejects variant fields on a single product", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "Confused Product",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "Sends variants without switching productType.",
      images: [IMAGE],
      variants: [{ price: 1, quantity: 1, options: [] }],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/multiple-version/i);
  });

  it("404s for an unknown category", async () => {
    const store = await makeStore();

    const res = await create(store, {
      title: "Orphan Product",
      category: new mongoose.Types.ObjectId().toString(),
      price: 1000,
      quantity: 1,
      description: "Category does not exist.",
      images: [IMAGE],
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("createProduct — multiple version", () => {
  const SNEAKER = (category) => ({
    title: "Court Classic Sneakers",
    productType: "variable",
    category: category._id.toString(),
    description: "Low-top leather sneakers.",
    images: [IMAGE],
    optionTypes: [
      { name: "Size", values: ["40", "41", "42"] },
      { name: "Color", values: ["Black", "White"] },
    ],
    variants: [
      {
        sku: "SNK-40-BLK",
        price: 45000,
        quantity: 5,
        options: [
          { name: "Size", value: "40" },
          { name: "Color", value: "Black" },
        ],
      },
      {
        sku: "SNK-41-WHT",
        price: 47000,
        quantity: 3,
        options: [
          { name: "Color", value: "White" },
          { name: "Size", value: "41" },
        ],
      },
    ],
  });

  it("creates a variable product and derives price and stock from its variants", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, SNEAKER(category));

    expect(res.statusCode).toBe(201);
    const product = res.body.data;

    expect(product.productType).toBe("variable");
    expect(product.price).toBe(45000); // cheapest variant — the "from ₦X" figure
    expect(product.listedPrice).toBe(45900); // 45000 + 2%
    expect(product.quantity).toBe(8); // 5 + 3
    expect(product.variants).toHaveLength(2);
    expect(product.variants[0].listedPrice).toBe(45900);
    expect(product.variants[1].listedPrice).toBe(47940);
    expect(product.optionTypes.map((t) => t.name)).toEqual(["Size", "Color"]);
  });

  it("does not require every combination to be listed", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    // 3 sizes × 2 colours = 6 possible, only 2 stocked.
    const res = await create(store, SNEAKER(category));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.variants).toHaveLength(2);
  });

  it("rejects a top-level price or quantity", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, { ...SNEAKER(category), price: 45000 });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/priced and stocked per variant/i);
  });

  it("rejects a variant value not declared in optionTypes", async () => {
    const store = await makeStore();
    const category = await makeCategory();
    const body = SNEAKER(category);
    body.variants[0].options[1].value = "Red";

    const res = await create(store, body);

    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/not a declared value/i);
  });

  it("rejects a variant missing one of the option axes", async () => {
    const store = await makeStore();
    const category = await makeCategory();
    const body = SNEAKER(category);
    body.variants[0].options = [{ name: "Size", value: "40" }];

    const res = await create(store, body);

    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/missing a value for option type/i);
  });

  it("rejects two variants covering the same combination", async () => {
    const store = await makeStore();
    const category = await makeCategory();
    const body = SNEAKER(category);
    body.variants[1].options = [
      { name: "Size", value: "40" },
      { name: "Color", value: "Black" },
    ];

    const res = await create(store, body);

    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/duplicates an earlier variant/i);
  });

  it("requires optionTypes and variants", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "Empty Variable Product",
      productType: "variable",
      category: category._id.toString(),
      description: "No option types supplied.",
      images: [IMAGE],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/optionTypes is required/i);
  });
});

describe("createProduct — category specifications", () => {
  it("requires the core specs for a phone category", async () => {
    const store = await makeStore();
    const category = await makeCategory({ specSchema: "phone" });

    const res = await create(store, {
      title: "Infinix Hot 40i",
      category: category._id.toString(),
      price: 132000,
      quantity: 8,
      description: "6.6 inch display.",
      images: [IMAGE],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([
        "Operating System is required",
        "RAM Size (Memory) is required",
        "ROM (Internal Storage) is required",
        "Screen Size (inches) is required",
        "Battery Capacity is required",
      ]),
    );
  });

  it("stores validated specs as ordered key/value pairs", async () => {
    const store = await makeStore();
    const category = await makeCategory({ specSchema: "phone" });

    const res = await create(store, {
      title: "Infinix Hot 40i",
      category: category._id.toString(),
      price: 132000,
      quantity: 8,
      description: "6.6 inch display.",
      images: [IMAGE],
      specifications: { ...PHONE_SPECS, warrantyDuration: "1 Year" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.specSchema).toBe("phone");

    const specs = res.body.data.specifications;
    expect(specs.find((s) => s.key === "operatingSystem").value).toBe("Android 13");
    expect(specs.find((s) => s.key === "warrantyDuration").value).toBe("1 Year");
    // Schema order, not payload order.
    expect(specs.map((s) => s.key)).toEqual([
      "operatingSystem",
      "ramSize",
      "romSize",
      "screenSize",
      "batteryCapacity",
      "warrantyDuration",
    ]);
  });

  it("rejects a dropdown value outside the allowed options", async () => {
    const store = await makeStore();
    const category = await makeCategory({ specSchema: "phone" });

    const res = await create(store, {
      title: "Odd RAM Phone",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "7GB is not an allowed RAM size.",
      images: [IMAGE],
      specifications: { ...PHONE_SPECS, ramSize: "7GB" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/RAM Size \(Memory\) must be one of/);
  });

  it("rejects an unknown specification key", async () => {
    const store = await makeStore();
    const category = await makeCategory({ specSchema: "phone" });

    const res = await create(store, {
      title: "Typo Spec Phone",
      category: category._id.toString(),
      price: 1000,
      quantity: 1,
      description: "Misspelled spec field.",
      images: [IMAGE],
      specifications: { ...PHONE_SPECS, ramSizes: "8GB" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/Unknown specification 'ramSizes'/);
  });

  it("inherits the parent category's spec schema", async () => {
    const store = await makeStore();
    const parent = await makeCategory({ specSchema: "computer" });
    const child = await makeCategory({ parent: parent._id });

    const res = await create(store, {
      title: "Laptop In A Subcategory",
      category: child._id.toString(),
      price: 500000,
      quantity: 2,
      description: "Spec schema comes from the parent category.",
      images: [IMAGE],
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/computer specifications/i);
    expect(res.body.errors).toEqual(
      expect.arrayContaining(["Processor (CPU) is required"]),
    );
  });

  it("keeps the legacy free-form array for categories without a schema", async () => {
    const store = await makeStore();
    const category = await makeCategory();

    const res = await create(store, {
      title: "Leather Bag",
      category: category._id.toString(),
      price: 12000,
      quantity: 4,
      description: "No spec schema on this category.",
      images: [IMAGE],
      specifications: [{ key: "Material", value: "Leather" }],
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.specifications[0]).toMatchObject({
      key: "Material",
      value: "Leather",
    });
  });
});

describe("categories — hierarchy", () => {
  it("creates a subcategory under a top-level category", async () => {
    const parent = await call(createProductCategory, {
      body: { name: `Phones & Accessories ${uniq()}`, specSchema: "phone" },
    });
    expect(parent.statusCode).toBe(201);

    const child = await call(createProductCategory, {
      body: { name: `Phone & Tablet ${uniq()}`, parent: parent.body.data._id.toString() },
    });

    expect(child.statusCode).toBe(201);
    expect(String(child.body.data.parent)).toBe(String(parent.body.data._id));
    expect(child.body.data.specSchema).toBeNull(); // inherited, not copied
  });

  it("rejects a third level", async () => {
    const parent = await makeCategory();
    const child = await makeCategory({ parent: parent._id });

    const grandchild = await call(createProductCategory, {
      body: { name: `Too Deep ${uniq()}`, parent: child._id.toString() },
    });

    expect(grandchild.statusCode).toBe(400);
    expect(grandchild.body.message).toMatch(/two levels deep/i);
  });

  it("rejects an unknown specSchema", async () => {
    const res = await call(createProductCategory, {
      body: { name: `Bad Schema ${uniq()}`, specSchema: "tractor" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/specSchema must be one of/);
  });

  it("actually applies updates (the old handler wrote nothing)", async () => {
    const category = await makeCategory();
    const newName = `Renamed ${uniq()}`;

    const res = await call(updateProductCategory, {
      body: { id: category._id.toString(), name: newName, specSchema: "phone" },
    });

    expect(res.statusCode).toBe(200);
    const reloaded = await Category.findById(category._id).lean();
    expect(reloaded.name).toBe(newName);
    expect(reloaded.specSchema).toBe("phone");
  });

  it("refuses to demote a category that has subcategories", async () => {
    const parentA = await makeCategory();
    const parentB = await makeCategory();
    await makeCategory({ parent: parentA._id });

    const res = await call(updateProductCategory, {
      body: { id: parentA._id.toString(), parent: parentB._id.toString() },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/has subcategories/i);
  });

  it("returns a flat list by default and a nested tree with ?tree=true", async () => {
    const parent = await makeCategory({ name: `AAA Parent ${uniq()}`, specSchema: "phone" });
    await makeCategory({ name: `AAA Child ${uniq()}`, parent: parent._id });

    const flat = await call(getProductCategories, {});
    expect(Array.isArray(flat.body)).toBe(true);

    const tree = await call(getProductCategories, { query: { tree: "true" } });
    expect(tree.body.success).toBe(true);

    const node = tree.body.data.categories.find(
      (c) => String(c._id) === String(parent._id),
    );
    expect(node.children).toHaveLength(1);
    // Resolved on the child even though only the parent declares it.
    expect(node.children[0].specSchema).toBe("phone");
  });
});

describe("GET spec-schemas", () => {
  it("returns every schema when no category is given", async () => {
    const res = await call(getSpecSchemas, {});

    expect(res.statusCode).toBe(200);
    expect(res.body.data.specSchemas.map((s) => s.key).sort()).toEqual([
      "computer",
      "phone",
    ]);

    const phone = res.body.data.specSchemas.find((s) => s.key === "phone");
    const ram = phone.fields.find((f) => f.id === "ramSize");
    expect(ram.type).toBe("select");
    expect(ram.required).toBe(true);
    expect(ram.options).toContain("8GB");

    // Warranty is appended to every schema and always optional.
    expect(phone.fields.find((f) => f.id === "warrantyType").required).toBe(false);
  });

  it("resolves the schema for one category, inheriting from the parent", async () => {
    const parent = await makeCategory({ specSchema: "computer" });
    const child = await makeCategory({ parent: parent._id });

    const res = await call(getSpecSchemas, { query: { category: child._id.toString() } });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.specSchema.key).toBe("computer");
  });

  it("returns a null schema for a category with no specification step", async () => {
    const category = await makeCategory();

    const res = await call(getSpecSchemas, { query: { category: category._id.toString() } });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.specSchema).toBeNull();
  });
});
