const Redis = require("ioredis");
const logger = require("../services/logger");

/**
 * Parse REDIS_URL into ioredis connection options.
 * Handles Redis 6 ACL auth (username:password) embedded in the URL.
 */
function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    const options = {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 6379,
      ...(parsed.username && parsed.username !== "default"
        ? { username: decodeURIComponent(parsed.username) }
        : {}),
      ...(parsed.password
        ? { password: decodeURIComponent(parsed.password) }
        : {}),
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      // Reconnect: wait 100 ms on first retry, cap at 3 s
      retryStrategy: (times) => Math.min(times * 100, 3_000),
    };

    // Render's managed Redis requires TLS.
    // rediss:// means SSL/TLS connection.
    if (parsed.protocol === "rediss:") {
      options.tls = {};
    }

    return options;
  } catch {
    return {
      host: "localhost",
      port: 6379,
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 100, 3_000),
    };
  }
}

const redisClient = new Redis(
  parseRedisUrl(process.env.REDIS_URL || "redis://localhost:6379"),
);

redisClient.on("error", (err) => {
  logger.warn("Redis client error", { error: err.message });
});

redisClient.on("connect", () => {
  console.log("Redis connected");
  logger.info("Redis connected");
});

redisClient.on("reconnecting", () => {
  console.log("Redis reconnecting…");
  logger.warn("Redis reconnecting…");
});

/**
 * Create a dedicated Redis connection using the same URL/credentials.
 * Use this when you need a separate connection (e.g. pub/sub subscribers,
 * which cannot share a connection used for regular commands).
 */
function createRedisConnection() {
  const conn = new Redis(
    parseRedisUrl(process.env.REDIS_URL || "redis://localhost:6379"),
  );
  conn.on("error", (err) =>
    logger.warn("Redis subscriber error", { error: err.message }),
  );
  return conn;
}

module.exports = redisClient;
module.exports.createRedisConnection = createRedisConnection;
