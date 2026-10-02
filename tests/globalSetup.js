const { MongoMemoryReplSet } = require("mongodb-memory-server");
const fs = require("fs");
const path = require("path");

module.exports = async () => {
  // A single-node replica set, not a standalone server: money paths run in
  // session.withTransaction(), which a standalone mongod rejects.
  const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongod.getUri();
  // Write URI to a temp file — workers can't inherit process.env from globalSetup
  fs.writeFileSync(path.join(__dirname, ".mongouri"), uri);
  global.__MONGOD__ = mongod;
};
