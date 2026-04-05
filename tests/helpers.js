const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const mongoose = require("mongoose");
const User = require("../models/userModel");
const Store = require("../models/storeModel");
const Product = require("../models/productModel");
const Category = require("../models/categoryModel");
const Cart = require("../models/cartModel");

const makeToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: "1d" });

/**
 * Create a test user and return the user + auth token.
 * The User model's pre('save') hook hashes the password, so pass raw password here.
 */
const createTestUser = async (overrides = {}) => {
  const rawPassword = "TestPass123!";
  const ts = Date.now();

  const user = await User.create({
    fullName: "Test User",
    email: `test-${ts}@example.com`,
    mobile: `2348${String(ts).slice(-8)}`,
    password: rawPassword,
    role: ["buyer"],
    activeRole: "buyer",
    status: "active",
    isBlocked: false,
    ...overrides,
  });

  return { user, token: makeToken(user._id), rawPassword };
};

/**
 * Create a test seller with a store
 */
const createTestSeller = async () => {
  const { user, token } = await createTestUser({
    role: ["seller"],
    activeRole: "seller",
  });

  const ts = Date.now();
  const store = await Store.create({
    name: `Test Store ${ts}`,
    mobile: `2347${String(ts).slice(-8)}`,
    owner: user._id,
    address: "123 Test Street",
  });

  return { user, token, store };
};

/**
 * Get or create a test category
 */
const getOrCreateCategory = async (name = "Test Category") => {
  let category = await Category.findOne({ name });
  if (!category) category = await Category.create({ name });
  return category;
};

/**
 * Create a test product in a store
 */
const createTestProduct = async (storeId, overrides = {}) => {
  const category = await getOrCreateCategory();
  const ts = Date.now();
  return Product.create({
    title: `Product ${ts}`,
    slug: `product-${ts}`,
    description: "A test product for unit testing",
    price: 5000,
    quantity: 10,
    store: storeId,
    category: category._id,
    ...overrides,
  });
};

/**
 * Set up a cart with items for a user
 */
const setupCart = async (userId, productId, storeId) => {
  return Cart.findOneAndUpdate(
    { owner: userId },
    {
      owner: userId,
      $push: { products: { product: productId, count: 1, price: 5000, store: storeId } },
      cartTotal: 5000,
    },
    { upsert: true, new: true }
  );
};

module.exports = {
  makeToken,
  createTestUser,
  createTestSeller,
  getOrCreateCategory,
  createTestProduct,
  setupCart,
};
