const fs = require("fs");
const path = require("path");

module.exports = async () => {
  if (global.__MONGOD__) {
    await global.__MONGOD__.stop();
  }
  const uriFile = path.join(__dirname, ".mongouri");
  if (fs.existsSync(uriFile)) fs.unlinkSync(uriFile);
};
