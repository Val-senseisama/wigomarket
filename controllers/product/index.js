const createProduct = require('./createProduct');
const getAProduct = require('./getAProduct');
const getAllProducts = require('./getAllProducts');
const updateProduct = require('./updateProduct');
const deleteProduct = require('./deleteProduct');
const createProductCategory = require('./createProductCategory');
const updateProductCategory = require('./updateProductCategory');
const getProductsByCategory = require('./getProductsByCategory');
const deleteProductCategory = require('./deleteProductCategory');
const getProductCategories = require('./getProductCategories');
const getProducts = require('./getProducts');
const getPersonalizedSuggestions = require('./getPersonalizedSuggestions');
const getTrendingProducts = require('./getTrendingProducts');
const getCategorySuggestions = require('./getCategorySuggestions');
const trackProductView = require('./trackProductView');

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
  getProducts,
  getPersonalizedSuggestions,
  getTrendingProducts,
  getCategorySuggestions,
  trackProductView
};
