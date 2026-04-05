const addToWishlist = require('./addToWishlist');
const removeFromWishlist = require('./removeFromWishlist');
const getWishlist = require('./getWishlist');
const checkProductInWishlist = require('./checkProductInWishlist');
const clearWishlist = require('./clearWishlist');
const updateWishlistSettings = require('./updateWishlistSettings');
const getPublicWishlist = require('./getPublicWishlist');

module.exports = {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  checkProductInWishlist,
  clearWishlist,
  updateWishlistSettings,
  getPublicWishlist
};
