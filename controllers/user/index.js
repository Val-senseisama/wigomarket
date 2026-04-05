const createUser = require('./createUser');
const createBuyer = require('./createBuyer');
const createSeller = require('./createSeller');
const createDeliveryAgent = require('./createDeliveryAgent');
const loginUser = require('./loginUser');
const getAllUsers = require('./getAllUsers');
const getAUser = require('./getAUser');
const deleteAUser = require('./deleteAUser');
const updateAUser = require('./updateAUser');
const blockUser = require('./blockUser');
const unblockUser = require('./unblockUser');
const handleRefreshToken = require('./handleRefreshToken');
const logoutUser = require('./logoutUser');
const forgotPasswordToken = require('./forgotPasswordToken');
const updatePassword = require('./updatePassword');
const resetPassword = require('./resetPassword');
const addToCart2 = require('./addToCart2');
const getUserCart = require('./getUserCart');
const emptyCart = require('./emptyCart');
const removeFromCart = require('./removeFromCart');
const verifyOtp = require('./verifyOtp');
const updateCart = require('./updateCart');
const getCurrentUser = require('./getCurrentUser');
const changeActiveRole = require('./changeActiveRole');
const googleAuth = require('./googleAuth');
const getUsersByStatus = require('./getUsersByStatus');

module.exports = {
  createUser,
  createBuyer,
  createSeller,
  createDeliveryAgent,
  loginUser,
  getAllUsers,
  getAUser,
  deleteAUser,
  updateAUser,
  blockUser,
  unblockUser,
  handleRefreshToken,
  logoutUser,
  forgotPasswordToken,
  updatePassword,
  resetPassword,
  addToCart2,
  getUserCart,
  emptyCart,
  removeFromCart,
  verifyOtp,
  updateCart,
  getCurrentUser,
  changeActiveRole,
  googleAuth,
  getUsersByStatus
};
