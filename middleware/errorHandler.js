/**
 * @file errorHandler.js
 * @description Global Express error handling middleware.
 *
 * SECURITY: stack traces are logged server-side but NEVER sent to clients in
 * production. The client receives only the message and a requestId they can
 * quote when contacting support.
 */

const logger = require("../services/logger");

// ── 404 handler ───────────────────────────────────────────────────────────────

const notFound = (req, res, next) => {
  const error = new Error(`Not Found: ${req.originalUrl}`);
  res.status(404);
  next(error);
};

// ── Centralised error handler ─────────────────────────────────────────────────

const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  const isProd = process.env.NODE_ENV === "production";

  // Log full error context server-side (stack trace, request details, user)
  logger.error(err.message, {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode,
    userId: req.user?._id?.toString(),
    role: req.user?.activeRole,
    ip: req.headers?.["x-forwarded-for"]?.split(",")[0] || req.ip,
    stack: err.stack,
    // Only include request body in non-production to aid debugging.
    // Never log body in production — it may contain card data or PII.
    ...(isProd ? {} : { body: req.body }),
  });

  res.status(statusCode).json({
    success: false,
    message: err.message,
    // requestId lets the user quote a reference ID when reporting the error
    requestId: req.requestId,
    // Stack trace only visible in non-production environments
    ...(isProd ? {} : { stack: err.stack }),
  });
};

module.exports = { errorHandler, notFound };
