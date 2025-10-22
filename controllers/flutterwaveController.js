const asyncHandler = require("express-async-handler");
const axios = require("axios");
const Redis = require("ioredis");
const { validateMongodbId } = require("../utils/validateMongodbId");
const { Validate } = require("../Helpers/Validate");
const { ThrowError } = require("../Helpers/Helpers");

// Redis client for caching
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

// Flutterwave API configuration
const FLUTTERWAVE_BASE_URL = "https://api.flutterwave.com/v3";
const FLUTTERWAVE_SECRET_KEY = process.env.FLW_SECRET_KEY;

/**
 * @function getBanksList
 * @description Get list of banks from Flutterwave with caching
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} [req.query.country] - Country code (default: NG)
 * @returns {Object} - List of banks
 */
const getBanksList = asyncHandler(async (req, res) => {
  const { country = 'NG' } = req.query;
  
  try {
    // Check cache first
    const cacheKey = `banks_list_${country}`;
    const cachedBanks = await redisClient.get(cacheKey);
    
    if (cachedBanks) {
      const banks = JSON.parse(cachedBanks);
      return res.json({
        success: true,
        message: "Banks fetched successfully from cache",
        data: banks,
        cached: true,
        timestamp: new Date()
      });
    }

    // Fetch from Flutterwave API
    const response = await axios.get(`${FLUTTERWAVE_BASE_URL}/banks/${country}`, {
      headers: {
        'Authorization': `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.status === 'success') {
      const banks = response.data.data;
      
      // Cache the result for 24 hours (86400 seconds)
      await redisClient.setex(cacheKey, 86400, JSON.stringify(banks));
      
      res.json({
        success: true,
        message: "Banks fetched successfully",
        data: banks,
        cached: false,
        timestamp: new Date()
      });
    } else {
      throw new Error(response.data.message || 'Failed to fetch banks');
    }
  } catch (error) {
    console.error('Error fetching banks:', error);
    
    // If API fails, try to return cached data
    try {
      const cacheKey = `banks_list_${country}`;
      const cachedBanks = await redisClient.get(cacheKey);
      
      if (cachedBanks) {
        const banks = JSON.parse(cachedBanks);
        return res.json({
          success: true,
          message: "Banks fetched from cache (API unavailable)",
          data: banks,
          cached: true,
          timestamp: new Date(),
          warning: "Using cached data due to API unavailability"
        });
      }
    } catch (cacheError) {
      console.error('Cache error:', cacheError);
    }
    
    throw new Error(error.response?.data?.message || error.message || 'Failed to fetch banks');
  }
});

/**
 * @function resolveAccountName
 * @description Resolve account name from bank account number and bank code
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.body.account_number - Bank account number
 * @param {string} req.body.account_bank - Bank code
 * @returns {Object} - Account details
 */
const resolveAccountName = asyncHandler(async (req, res) => {
  const { account_number, account_bank } = req.body;
  
  // Validate input
  if (!account_number || !account_bank) {
    return res.status(400).json({
      success: false,
      message: "Account number and bank code are required"
    });
  }

  if (!Validate.string(account_number) || account_number.length < 10) {
    return res.status(400).json({
      success: false,
      message: "Invalid account number format"
    });
  }

  if (!Validate.string(account_bank)) {
    return res.status(400).json({
      success: false,
      message: "Invalid bank code format"
    });
  }

  try {
    // Check cache first
    const cacheKey = `account_resolve_${account_bank}_${account_number}`;
    const cachedResult = await redisClient.get(cacheKey);
    
    if (cachedResult) {
      const accountData = JSON.parse(cachedResult);
      return res.json({
        success: true,
        message: "Account resolved successfully from cache",
        data: accountData,
        cached: true,
        timestamp: new Date()
      });
    }

    // Resolve account from Flutterwave API
    const response = await axios.post(`${FLUTTERWAVE_BASE_URL}/accounts/resolve`, {
      account_number: account_number,
      account_bank: account_bank
    }, {
      headers: {
        'Authorization': `Bearer ${FLUTTERWAVE_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.status === 'success') {
      const accountData = response.data.data;
      
      // Cache the result for 1 hour (3600 seconds)
      await redisClient.setex(cacheKey, 3600, JSON.stringify(accountData));
      
      res.json({
        success: true,
        message: "Account resolved successfully",
        data: {
          account_number: accountData.account_number,
          account_name: accountData.account_name,
          bank_code: account_bank,
          bank_name: accountData.bank_name || 'Unknown Bank'
        },
        cached: false,
        timestamp: new Date()
      });
    } else {
      throw new Error(response.data.message || 'Failed to resolve account');
    }
  } catch (error) {
    console.error('Error resolving account:', error);
    
    // If API fails, try to return cached data
    try {
      const cacheKey = `account_resolve_${account_bank}_${account_number}`;
      const cachedResult = await redisClient.get(cacheKey);
      
      if (cachedResult) {
        const accountData = JSON.parse(cachedResult);
        return res.json({
          success: true,
          message: "Account resolved from cache (API unavailable)",
          data: {
            account_number: accountData.account_number,
            account_name: accountData.account_name,
            bank_code: account_bank,
            bank_name: accountData.bank_name || 'Unknown Bank'
          },
          cached: true,
          timestamp: new Date(),
          warning: "Using cached data due to API unavailability"
        });
      }
    } catch (cacheError) {
      console.error('Cache error:', cacheError);
    }
    
    const errorMessage = error.response?.data?.message || error.message || 'Failed to resolve account';
    
    res.status(400).json({
      success: false,
      message: errorMessage,
      data: null
    });
  }
});

/**
 * @function getBankByCode
 * @description Get bank details by bank code
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} req.params.bankCode - Bank code
 * @returns {Object} - Bank details
 */
const getBankByCode = asyncHandler(async (req, res) => {
  const { bankCode } = req.params;
  
  if (!bankCode) {
    return res.status(400).json({
      success: false,
      message: "Bank code is required"
    });
  }

  try {
    // Check cache first
    const cacheKey = `bank_details_${bankCode}`;
    const cachedBank = await redisClient.get(cacheKey);
    
    if (cachedBank) {
      const bank = JSON.parse(cachedBank);
      return res.json({
        success: true,
        message: "Bank details fetched successfully from cache",
        data: bank,
        cached: true,
        timestamp: new Date()
      });
    }

    // Get banks list and find the specific bank
    const banksResponse = await getBanksList({ query: { country: 'NG' } });
    const banks = banksResponse.data || [];
    
    const bank = banks.find(b => b.code === bankCode);
    
    if (!bank) {
      return res.status(404).json({
        success: false,
        message: "Bank not found",
        data: null
      });
    }

    // Cache the result for 24 hours
    await redisClient.setex(cacheKey, 86400, JSON.stringify(bank));
    
    res.json({
      success: true,
      message: "Bank details fetched successfully",
      data: bank,
      cached: false,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error fetching bank details:', error);
    throw new Error(error.message || 'Failed to fetch bank details');
  }
});

/**
 * @function clearBanksCache
 * @description Clear banks cache (Admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Cache clear result
 */
const clearBanksCache = asyncHandler(async (req, res) => {
  try {
    // Clear all bank-related cache keys
    const keys = await redisClient.keys('banks_list_*');
    const accountKeys = await redisClient.keys('account_resolve_*');
    const bankDetailKeys = await redisClient.keys('bank_details_*');
    
    const allKeys = [...keys, ...accountKeys, ...bankDetailKeys];
    
    if (allKeys.length > 0) {
      await redisClient.del(...allKeys);
    }
    
    res.json({
      success: true,
      message: `Cleared ${allKeys.length} cache entries`,
      data: {
        clearedKeys: allKeys.length,
        keys: allKeys
      }
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    throw new Error(error.message || 'Failed to clear cache');
  }
});

/**
 * @function getCacheStats
 * @description Get cache statistics (Admin only)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Object} - Cache statistics
 */
const getCacheStats = asyncHandler(async (req, res) => {
  try {
    const banksKeys = await redisClient.keys('banks_list_*');
    const accountKeys = await redisClient.keys('account_resolve_*');
    const bankDetailKeys = await redisClient.keys('bank_details_*');
    
    const stats = {
      banksListCache: banksKeys.length,
      accountResolveCache: accountKeys.length,
      bankDetailsCache: bankDetailKeys.length,
      totalCacheEntries: banksKeys.length + accountKeys.length + bankDetailKeys.length,
      cacheKeys: {
        banks: banksKeys,
        accounts: accountKeys,
        bankDetails: bankDetailKeys
      }
    };
    
    res.json({
      success: true,
      message: "Cache statistics retrieved successfully",
      data: stats
    });
  } catch (error) {
    console.error('Error getting cache stats:', error);
    throw new Error(error.message || 'Failed to get cache statistics');
  }
});

module.exports = {
  getBanksList,
  resolveAccountName,
  getBankByCode,
  clearBanksCache,
  getCacheStats
};
