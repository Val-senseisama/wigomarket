/**
 * Product listing tests — GET /api/product/get-products, which backs both the
 * public storefront grid and the seller's own "Product List" screen.
 *
 * The controller is called directly with a stub req/res, as in
 * createProduct.test.js: the route layer is just optionalAuthMiddleware, and
 * all the behaviour worth testing is in the filtering and the card shape.
 */

const {
  getAllProducts,
  updateProduct,
  getAProduct,
} = require("../controllers/productController");
const Product = require("../models/productModel");
const Store = require("../models/storeModel");
const User = require("../models/userModel");
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

const makeSeller = async () => {
  const n = uniq();
  const user = await User.create({
    fullName: "List Seller",
    email: `seller-${n}@example.com`,
    mobile: `2348${n.slice(-8)}`,
    password: "TestPass123!",
    role: ["seller"],
    activeRole: "seller",
    status: "active",
  });
  const store = await Store.create({
    name: `List Store ${n}`,
    mobile: `2347${n.slice(-8)}`,
    email: `store-${n}@example.com`,
    owner: user._id,
    address: "1 Test Street",
    ownerNIN: n.slice(-11),
    state: "Lagos",
    city: "Ikeja",
    businessType: "retail",
  });
  return { user, store };
};

const makeCategory = () => Category.create({ name: `Category ${uniq()}` });

const IMAGE = "https://res.cloudinary.com/demo/image/upload/v1/products/main.jpg";

const makeProduct = (store, category, overrides = {}) =>
  Product.create({
    title: "Men's Casual Short Sleeve Shirt",
    slug: `shirt-${uniq()}`,
    description: "Breathable cotton shirt.",
    price: 4900,
    listedPrice: 5000,
    quantity: 50,
    sold: 12,
    category: category._id,
    store: store._id,
    images: [IMAGE],
    ...overrides,
  });

// Public caller — no req.user, exactly what optionalAuthMiddleware leaves.
const listPublic = (query = {}) => call(getAllProducts, { query });
// Seller listing their own shelf.
const listMine = (user, query = {}) =>
  call(getAllProducts, { query: { mine: "true", ...query }, user });

describe("getAllProducts — card payload", () => {
  it("returns every field the product card renders", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, {
      sku: "WM1201",
      productType: "variable",
      rating: { average: 4.5, count: 131 },
      optionTypes: [{ name: "Size", values: ["M", "L"] }],
      variants: [
        { sku: "WM1201-M", price: 4900, listedPrice: 5000, quantity: 30, sold: 8, options: [{ name: "Size", value: "M" }] },
        { sku: "WM1201-L", price: 6300, listedPrice: 6500, quantity: 20, sold: 4, options: [{ name: "Size", value: "L" }] },
      ],
    });

    const res = await listMine(user);
    const card = res.body.data[0];

    expect(card.sku).toBe("WM1201");
    expect(card.title).toBe("Men's Casual Short Sleeve Shirt");
    expect(card.image).toBe(IMAGE);
    expect(card.listedPrice).toBe(5000);
    expect(card.currency).toBe("NGN");
    expect(card.stock).toBe(50);
    expect(card.sold).toBe(12);
    expect(card.variantCount).toBe(2);
    expect(card.priceRange).toEqual({ from: 5000, to: 6500 });
    expect(card.rating).toEqual({ average: 4.5, count: 131 });
    expect(card.displayStatus).toBe("active");
    expect(card.statusLabel).toBe("Active");
    expect(card.category.name).toBe(category.name);
    expect(card.store.name).toBe(store.name);
    // mine=true embeds variants so the seller grid can show per-version stock.
    expect(card.variants).toHaveLength(2);
    expect(card.variants[0].inStock).toBe(true);
  });

  it("reports variantCount 0 for a single product and omits variants publicly", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category);

    const card = (await listPublic()).body.data[0];

    expect(card.productType).toBe("single");
    expect(card.variantCount).toBe(0);
    expect(card.priceRange).toBeNull();
    expect(card.variants).toBeUndefined();
  });

  it("derives out_of_stock from quantity, and hidden wins over stock", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, { title: "Sold Out Cake", quantity: 0 });
    await makeProduct(store, category, { title: "Hidden But Stocked", quantity: 7, status: "hidden" });

    const byTitle = Object.fromEntries(
      (await listMine(user)).body.data.map((p) => [p.title, p]),
    );

    expect(byTitle["Sold Out Cake"].displayStatus).toBe("out_of_stock");
    expect(byTitle["Sold Out Cake"].statusLabel).toBe("Out of stock");
    expect(byTitle["Sold Out Cake"].status).toBe("active"); // stored value untouched
    expect(byTitle["Hidden But Stocked"].displayStatus).toBe("hidden");
  });
});

describe("getAllProducts — search", () => {
  it("matches on product name", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, { title: "Light Weight Mens Canvas Shoe" });
    await makeProduct(store, category, { title: "Sprinkle Birthday Cake" });

    const res = await listMine(user, { search: "canvas" });

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Light Weight Mens Canvas Shoe");
  });

  it("matches on SKU, with or without a leading #", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, { sku: "WM1201" });
    await makeProduct(store, category, { sku: "WM9999", title: "Other Item" });

    expect((await listMine(user, { search: "WM1201" })).body.data).toHaveLength(1);
    expect((await listMine(user, { search: "#WM1201" })).body.data).toHaveLength(1);
  });

  it("treats regex metacharacters in the term literally", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, { title: "Cake (Large)" });
    await makeProduct(store, category, { title: "Cake Small" });

    const res = await listMine(user, { search: "Cake (Large)" });

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe("Cake (Large)");
  });
});

describe("getAllProducts — status filter and visibility", () => {
  const seed = async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, { title: "Active One", quantity: 5 });
    await makeProduct(store, category, { title: "Out Of Stock One", quantity: 0 });
    await makeProduct(store, category, { title: "Hidden One", status: "hidden" });
    return { user, store, category };
  };

  it("defaults to everything on the seller's own list, with counts for the chips", async () => {
    const { user } = await seed();

    const res = await listMine(user);

    expect(res.body.appliedStatus).toBe("all");
    expect(res.body.data).toHaveLength(3);
    expect(res.body.counts).toEqual({ all: 3, active: 1, out_of_stock: 1, hidden: 1 });
  });

  it("filters the seller's list by each status", async () => {
    const { user } = await seed();

    const active = await listMine(user, { status: "active" });
    const out = await listMine(user, { status: "out_of_stock" });
    const hidden = await listMine(user, { status: "hidden" });

    expect(active.body.data.map((p) => p.title)).toEqual(["Active One"]);
    expect(out.body.data.map((p) => p.title)).toEqual(["Out Of Stock One"]);
    expect(hidden.body.data.map((p) => p.title)).toEqual(["Hidden One"]);
  });

  it("accepts the spellings a UI dropdown sends", async () => {
    const { user } = await seed();

    const res = await listMine(user, { status: "Out of stock" });

    expect(res.body.appliedStatus).toBe("out_of_stock");
    expect(res.body.data.map((p) => p.title)).toEqual(["Out Of Stock One"]);
  });

  it("shows only active, in-stock products to a public caller", async () => {
    await seed();

    const res = await listPublic();

    expect(res.body.appliedStatus).toBe("active");
    expect(res.body.data.map((p) => p.title)).toEqual(["Active One"]);
  });

  it("never returns hidden products to a public caller, whatever they ask for", async () => {
    await seed();

    const asHidden = await listPublic({ status: "hidden" });
    const asAll = await listPublic({ status: "all" });

    expect(asHidden.body.data).toHaveLength(0);
    expect(asAll.body.data.map((p) => p.title).sort()).toEqual([
      "Active One",
      "Out Of Stock One",
    ]);
  });
});

describe("getAllProducts — scoping, sorting and pagination", () => {
  it("scopes mine=true to the caller's own store", async () => {
    const mine = await makeSeller();
    const other = await makeSeller();
    const category = await makeCategory();
    await makeProduct(mine.store, category, { title: "My Product" });
    await makeProduct(other.store, category, { title: "Someone Else's Product" });

    const res = await listMine(mine.user);

    expect(res.body.data.map((p) => p.title)).toEqual(["My Product"]);
  });

  it("rejects mine=true without a signed-in user", async () => {
    const res = await call(getAllProducts, { query: { mine: "true" } });

    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("404s when a signed-in user has no store", async () => {
    const n = uniq();
    const user = await User.create({
      fullName: "No Store",
      email: `nostore-${n}@example.com`,
      mobile: `2349${n.slice(-8)}`,
      password: "TestPass123!",
      role: ["seller"],
      activeRole: "seller",
      status: "active",
    });

    const res = await call(getAllProducts, { query: { mine: "true" }, user });

    expect(res.statusCode).toBe(404);
  });

  it("filters by store and by category", async () => {
    const { store } = await makeSeller();
    const other = await makeSeller();
    const shirts = await makeCategory();
    const cakes = await makeCategory();
    await makeProduct(store, shirts, { title: "Shirt" });
    await makeProduct(store, cakes, { title: "Cake" });
    await makeProduct(other.store, shirts, { title: "Rival Shirt" });

    const byStore = await listPublic({ store: store._id.toString() });
    const byCategory = await listPublic({
      store: store._id.toString(),
      category: cakes._id.toString(),
    });

    expect(byStore.body.data).toHaveLength(2);
    expect(byCategory.body.data.map((p) => p.title)).toEqual(["Cake"]);
  });

  it("sorts by price and by units sold", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    await makeProduct(store, category, { title: "Cheap", listedPrice: 1000, sold: 2 });
    await makeProduct(store, category, { title: "Dear", listedPrice: 9000, sold: 40 });

    const cheapest = await listMine(user, { sort: "price_asc" });
    const bestSelling = await listMine(user, { sort: "best_selling" });

    expect(cheapest.body.data.map((p) => p.title)).toEqual(["Cheap", "Dear"]);
    expect(bestSelling.body.data.map((p) => p.title)).toEqual(["Dear", "Cheap"]);
  });

  it("paginates, and keeps the legacy top-level page keys working", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    for (let i = 0; i < 5; i += 1) {
      await makeProduct(store, category, { title: `Item ${i}` });
    }

    const page1 = await listMine(user, { limit: 2, page: 1 });
    const page3 = await listMine(user, { limit: 2, page: 3 });

    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination).toMatchObject({ total: 5, page: 1, limit: 2, pages: 3, hasMore: true });
    expect(page1.body.totalProducts).toBe(5);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.currentPage).toBe(1);

    expect(page3.body.data).toHaveLength(1);
    expect(page3.body.pagination.hasMore).toBe(false);
  });

  it("caps limit at 100", async () => {
    const { user } = await makeSeller();

    const res = await listMine(user, { limit: 5000 });

    expect(res.body.pagination.limit).toBe(100);
  });
});

describe("updateProduct — hide and unhide", () => {
  const update = (store, id, body) =>
    call(updateProduct, { params: { id }, body, store: store._id, user: { _id: store.owner } });

  it("hides a product, taking it off the public listing", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const res = await update(store, product._id.toString(), { status: "hidden" });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe("hidden");
    expect((await listPublic()).body.data).toHaveLength(0);
    expect((await listMine(user)).body.data[0].displayStatus).toBe("hidden");
  });

  it("rejects a status the model does not store", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const res = await update(store, product._id.toString(), { status: "out_of_stock" });

    expect(res.statusCode).toBe(400);
  });

  it("will not update a product belonging to another store", async () => {
    const mine = await makeSeller();
    const other = await makeSeller();
    const category = await makeCategory();
    const theirProduct = await makeProduct(other.store, category);

    const res = await update(mine.store, theirProduct._id.toString(), { status: "hidden" });

    expect(res.statusCode).toBe(404);
    expect(await Product.findById(theirProduct._id)).toMatchObject({ status: "active" });
  });
});

describe("getAProduct — hidden products", () => {
  it("404s for a public caller but loads for the owner", async () => {
    const { user, store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category, { status: "hidden" });
    const id = product._id.toString();

    const anonymous = await call(getAProduct, { params: { id } });
    const owner = await call(getAProduct, { params: { id }, user });
    const stranger = await makeSeller();
    const someoneElse = await call(getAProduct, { params: { id }, user: stranger.user });

    expect(anonymous.statusCode).toBe(404);
    expect(owner.statusCode).toBe(200);
    expect(owner.body.data.status).toBe("hidden");
    expect(someoneElse.statusCode).toBe(404);
  });

  it("still loads an active product for anyone", async () => {
    const { store } = await makeSeller();
    const category = await makeCategory();
    const product = await makeProduct(store, category);

    const res = await call(getAProduct, { params: { id: product._id.toString() } });

    expect(res.statusCode).toBe(200);
  });
});
