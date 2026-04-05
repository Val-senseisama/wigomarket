const createWallet = require('./createWallet');
const getWallet = require('./getWallet');
const updateBankAccount = require('./updateBankAccount');
const requestWithdrawal = require('./requestWithdrawal');
const getWithdrawalHistory = require('./getWithdrawalHistory');
const getWalletStats = require('./getWalletStats');

module.exports = {
  createWallet,
  getWallet,
  updateBankAccount,
  requestWithdrawal,
  getWithdrawalHistory,
  getWalletStats
};
