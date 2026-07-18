const mongoose = require("mongoose");
const validateMongodbId = (id) => {
  const isValid = mongoose.Types.ObjectId.isValid(id);
  if (!isValid) throw new Error("This is not valid");
};
// Exported both ways on purpose: most call sites do
//   const validateMongodbId = require("...")
// but ~30 others destructure
//   const { validateMongodbId } = require("...")
// which silently yielded undefined and threw "is not a function" (HTTP 500)
// the moment the endpoint validated an id.
module.exports = validateMongodbId;
module.exports.validateMongodbId = validateMongodbId;
