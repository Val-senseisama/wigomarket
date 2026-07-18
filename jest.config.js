module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  globalSetup: "./tests/globalSetup.js",
  globalTeardown: "./tests/globalTeardown.js",
  setupFiles: ["./tests/envSetup.js"],      // runs in worker, sets env vars before app loads
  setupFilesAfterEnv: ["./tests/setup.js"], // runs after test framework, handles DB connect
  testTimeout: 30000,
  verbose: true,
  // Every test file shares one in-memory MongoDB, and tests/setup.js wipes all
  // collections in afterEach. Run serially so one file's cleanup cannot delete
  // another file's fixtures mid-request (showed up as sporadic "User not
  // found" 500s and duplicate-key errors).
  maxWorkers: 1,
};
