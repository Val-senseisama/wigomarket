const asyncHandler = require("express-async-handler");
const redisClient = require("../config/redisClient");
const { Validate } = require("../Helpers/Validate");
const payments = require("../services/payments");

// Bank codes and resolved names come from the active payment provider, so the
// cache is keyed by provider: switching providers never serves the old list.
const BANKS_TTL_S = 24 * 60 * 60;
const ACCOUNT_TTL_S = 60 * 60;
const banksKey = (provider) => `banks_list_${provider}`;
const accountKey = (provider, bankCode, accountNumber) => `account_resolve_${provider}_${bankCode}_${accountNumber}`;
const CACHE_PATTERNS = ["banks_list_*", "account_resolve_*"];

async function cachedJson(key) {
  try {
    const hit = await redisClient.get(key);
    return hit ? JSON.parse(hit) : null;
  } catch (err) {
    console.error("[Banks] Cache read failed:", err.message);
    return null;
  }
}

async function cacheJson(key, ttl, value) {
  try {
    await redisClient.setex(key, ttl, JSON.stringify(value));
  } catch (err) {
    console.error("[Banks] Cache write failed:", err.message);
  }
}

/** Banks from cache, else from the provider (and cached). */
async function loadBanks() {
  const provider = payments.getProvider();
  const cached = await cachedJson(banksKey(provider.name));
  if (cached) return { banks: cached, cached: true };
  const banks = await provider.listBanks();
  await cacheJson(banksKey(provider.name), BANKS_TTL_S, banks);
  return { banks, cached: false };
}

/**
 * @function getBanksList
 * @description Nigerian banks supported by the active payment provider, as
 * `[{ code, name }]`. `code` is what bank-account endpoints expect as `bankCode`.
 */
const getBanksList = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await loadBanks();
  } catch (err) {
    console.error("[Banks] Fetching banks failed:", err.message);
    return res.status(502).json({ success: false, message: "Could not fetch banks. Please try again." });
  }
  res.json({
    success: true,
    message: result.cached ? "Banks fetched successfully from cache" : "Banks fetched successfully",
    data: result.banks,
    cached: result.cached,
    provider: payments.activeProviderName(),
    timestamp: new Date(),
  });
});

/**
 * @function getBankByCode
 * @description One bank from the active provider's list.
 */
const getBankByCode = asyncHandler(async (req, res) => {
  const { bankCode } = req.params;
  let banks;
  try {
    ({ banks } = await loadBanks());
  } catch (err) {
    console.error("[Banks] Fetching banks failed:", err.message);
    return res.status(502).json({ success: false, message: "Could not fetch banks. Please try again." });
  }
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) {
    return res.status(404).json({ success: false, message: "Bank not found", data: null });
  }
  res.json({ success: true, message: "Bank details fetched successfully", data: bank, timestamp: new Date() });
});

/**
 * @function resolveAccountName
 * @description Look up the account holder's name for a bank account.
 * @param {string} req.body.account_number - 10-digit NUBAN
 * @param {string} req.body.account_bank   - Bank code from GET /api/banks
 */
const resolveAccountName = asyncHandler(async (req, res) => {
  const { account_number, account_bank } = req.body;

  if (!account_number || !account_bank) {
    return res.status(400).json({
      success: false,
      message: "Account number and bank code are required",
    });
  }

  if (!Validate.string(account_number) || !/^\d{10}$/.test(account_number)) {
    return res.status(400).json({
      success: false,
      message: "Invalid account number format",
    });
  }

  if (!Validate.string(account_bank)) {
    return res.status(400).json({
      success: false,
      message: "Invalid bank code format",
    });
  }

  const provider = payments.getProvider();
  const key = accountKey(provider.name, account_bank, account_number);
  let account = await cachedJson(key);
  const cached = Boolean(account);

  if (!account) {
    try {
      account = await provider.resolveAccount({ accountNumber: account_number, bankCode: account_bank });
    } catch (err) {
      console.error("[Banks] Resolving account failed:", err.message);
      return res.status(400).json({
        success: false,
        message: "Could not resolve this account. Check the account number and bank.",
        data: null,
      });
    }
    await cacheJson(key, ACCOUNT_TTL_S, account);
  }

  res.json({
    success: true,
    message: cached ? "Account resolved successfully from cache" : "Account resolved successfully",
    data: {
      account_number: account.accountNumber,
      account_name: account.accountName,
      bank_code: account_bank,
    },
    cached,
    timestamp: new Date(),
  });
});

const cacheKeys = async () => (await Promise.all(CACHE_PATTERNS.map((p) => redisClient.keys(p)))).flat();

/**
 * @function clearBanksCache
 * @description Clear cached banks and account lookups (admin only).
 */
const clearBanksCache = asyncHandler(async (req, res) => {
  const keys = await cacheKeys();
  if (keys.length > 0) await redisClient.del(...keys);
  res.json({
    success: true,
    message: `Cleared ${keys.length} cache entries`,
    data: { clearedKeys: keys.length, keys },
  });
});

/**
 * @function getCacheStats
 * @description Counts of cached banks lists and account lookups (admin only).
 */
const getCacheStats = asyncHandler(async (req, res) => {
  const [banks, accounts] = await Promise.all(CACHE_PATTERNS.map((p) => redisClient.keys(p)));
  res.json({
    success: true,
    message: "Cache statistics retrieved successfully",
    data: {
      banksListCache: banks.length,
      accountResolveCache: accounts.length,
      totalCacheEntries: banks.length + accounts.length,
      cacheKeys: { banks, accounts },
    },
  });
});

module.exports = {
  getBanksList,
  resolveAccountName,
  getBankByCode,
  clearBanksCache,
  getCacheStats,
};
