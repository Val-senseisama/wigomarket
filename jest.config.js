module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  globalSetup: "./tests/globalSetup.js",
  globalTeardown: "./tests/globalTeardown.js",
  setupFiles: ["./tests/envSetup.js"],      // runs in worker, sets env vars before app loads
  setupFilesAfterEnv: ["./tests/setup.js"], // runs after test framework, handles DB connect
  testTimeout: 30000,
  verbose: true,
};
