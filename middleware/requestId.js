/**
 * @file requestId.js
 * @description Attaches a unique request ID to every inbound request.
 *
 * The ID is:
 *   - Read from the x-request-id header if already present (e.g. set by a
 *     load balancer or API gateway upstream)
 *   - Generated fresh as a UUIDv4 otherwise
 *
 * The ID is:
 *   - Stored on req.requestId for use in error handlers and audit logs
 *   - Echoed in the x-request-id response header so clients can
 *     quote it when reporting bugs
 */

const { v4: uuidv4 } = require("uuid");

function requestId(req, res, next) {
  const id = req.headers["x-request-id"] || uuidv4();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}

module.exports = requestId;
