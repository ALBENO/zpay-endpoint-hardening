/**
 * Sends a structured error response in the shape required by the contract:
 * {
 *   "error": {
 *     "code": "error_code_slug",
 *     "param": "field_name",
 *     "message": "human readable message"
 *   }
 * }
 *
 * `param` is optional at the call site (some errors, like auth failures,
 * are not tied to a single field) and will simply be omitted/null in that case.
 */
function sendError(res, status, code, message, param = null) {
  return res.status(status).json({
    error: {
      code,
      param,
      message,
    },
  });
}

module.exports = { sendError };
