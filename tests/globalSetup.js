const { MongoMemoryServer } = require("mongodb-memory-server");
const fs = require("fs");
const path = require("path");

module.exports = async () => {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  // Write URI to a temp file — workers can't inherit process.env from globalSetup
  fs.writeFileSync(path.join(__dirname, ".mongouri"), uri);
  global.__MONGOD__ = mongod;
};
