const redisClient = require("../config/redisClient");

/**
 * Version stamp for the cached home categories section. Every category write
 * bumps it, so a new name or image shows straight away instead of after the
 * 30-minute TTL — one counter covers every `limit` variant of the key.
 */
const VERSION_KEY = "home:categories:ver";

const categoryCacheVersion = async () => {
  try {
    return (await redisClient.get(VERSION_KEY)) || "0";
  } catch (_) {
    return "0";
  }
};

const bumpCategoryCacheVersion = async () => {
  try {
    await redisClient.incr(VERSION_KEY);
  } catch (_) {}
};

module.exports = { categoryCacheVersion, bumpCategoryCacheVersion };
