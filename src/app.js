const express = require("express");
const { sendError } = require("./lib/apiError");
const paymentsRouter = require("./routes/payments");

function createApp() {
  const app = express();

  app.use(express.json());

  // Malformed JSON bodies should surface as a clean 400, not a stack trace.
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
      return sendError(res, 400, "invalid_json", "Request body is not valid JSON.", "body");
    }
    next(err);
  });

  app.use(paymentsRouter);

  // Fallback 404 for anything outside the contract.
  app.use((req, res) => {
    return sendError(res, 404, "not_found", "The requested resource does not exist.", null);
  });

  // Generic error handler as a safety net.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    return sendError(res, 500, "internal_error", "An unexpected error occurred.", null);
  });

  return app;
}

module.exports = { createApp };
