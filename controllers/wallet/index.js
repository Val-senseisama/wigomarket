const createWallet = require('./createWallet');
const getWallet = require('./getWallet');
const addBankAccount = require('./updateBankAccount');        // POST  /bank-account
const setDefaultBankAccount = require('./setDefaultBankAccount'); // PUT /bank-account/:id/default
const deleteBankAccount = require('./deleteBankAccount');     // DELETE /bank-account/:id
const requestWithdrawal = require('./requestWithdrawal');
const getWithdrawalHistory = require('./getWithdrawalHistory');
const getWalletStats = require('./getWalletStats');
const getEarningsOverview = require('./getEarningsOverview');
const {
  createWithdrawalPin,
  changeWithdrawalPin,
  forgotWithdrawalPin,
  verifyWithdrawalPinReset,
  resetWithdrawalPin,
} = require('./withdrawalPin');

module.exports = {
  createWallet,
  getWallet,
  addBankAccount,
  setDefaultBankAccount,
  deleteBankAccount,
  requestWithdrawal,
  getWithdrawalHistory,
  getWalletStats,
  getEarningsOverview,
  createWithdrawalPin,
  changeWithdrawalPin,
  forgotWithdrawalPin,
  verifyWithdrawalPinReset,
  resetWithdrawalPin,
};
