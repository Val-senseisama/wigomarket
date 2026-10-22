const createSupportRequest = require("./createSupportRequest");
const { listMySupportRequests, getMySupportRequest } = require("./getMySupportRequests");
const { listSupportRequests, updateSupportRequest } = require("./admin");

module.exports = {
  createSupportRequest,
  listMySupportRequests,
  getMySupportRequest,
  listSupportRequests,
  updateSupportRequest,
};
