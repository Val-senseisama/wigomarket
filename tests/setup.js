const mongoose = require("mongoose");

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI);
  }
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.close();

  // config/redisClient.js opens an ioredis connection at require time, with a
  // retryStrategy that never gives up. Any suite that loads a controller drags
  // it in, and the open socket kept jest alive long after the tests finished.
  // Resolve through the cache so suites that never touched Redis do not open a
  // connection here just to close it.
  const redisPath = require.resolve("../config/redisClient");
  if (require.cache[redisPath]) {
    require.cache[redisPath].exports.disconnect();
  }
});
