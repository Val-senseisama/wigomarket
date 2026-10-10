/**
 * Pattern-based Redis key helpers built on SCAN.
 *
 * KEYS walks the whole keyspace in one blocking call, stalling every other
 * Redis client (rate limiters, caches, the task queue) while it runs. SCAN
 * iterates in small batches instead, so these are safe on a large keyspace.
 */
const redisClient = require("../config/redisClient");

const SCAN_COUNT = 500;
const DEL_BATCH = 500;

/** Every key matching `pattern` (glob syntax, as for KEYS). */
const scanKeys = (pattern) =>
  new Promise((resolve, reject) => {
    const keys = new Set(); // SCAN may return a key more than once
    redisClient
      .scanStream({ match: pattern, count: SCAN_COUNT })
      .on("data", (batch) => batch.forEach((k) => keys.add(k)))
      .on("end", () => resolve([...keys]))
      .on("error", reject);
  });

/** Keys matching any of `patterns`, de-duplicated. */
const scanKeysForPatterns = async (patterns) => [
  ...new Set((await Promise.all(patterns.map(scanKeys))).flat()),
];

/**
 * Delete every key matching any of `patterns`.
 * @returns {Promise<string[]>} the keys deleted
 */
const deleteByPatterns = async (patterns) => {
  const keys = await scanKeysForPatterns(patterns);
  for (let i = 0; i < keys.length; i += DEL_BATCH) {
    await redisClient.del(...keys.slice(i, i + DEL_BATCH));
  }
  return keys;
};

module.exports = { scanKeys, scanKeysForPatterns, deleteByPatterns };
