const { sendError } = require("../lib/apiError");
const { validateToken } = require("../lib/store");

/**
 * Requires a valid `Authorization: Bearer <token>` header.
 * On success, attaches `req.user = { id, role }`.
 * Returns 401 if the header is missing or the token is invalid.
 */
function authenticate(req, res, next) {
  const header = req.headers["authorization"];

  if (!header || !header.startsWith("Bearer ")) {
    return sendError(
      res,
      401,
      "unauthorized",
      "Missing or malformed Authorization header. Expected 'Bearer <token>'.",
      "authorization"
    );
  }

  const token = header.slice("Bearer ".length).trim();
  const user = token ? validateToken(token) : null;

  if (!user) {
    return sendError(
      res,
      401,
      "invalid_token",
      "The provided auth token is invalid or expired.",
      "authorization"
    );
  }

  req.user = user;
  next();
}

/**
 * Requires the authenticated user's role to be one of `allowedRoles`.
 * Must run after `authenticate`. Returns 403 for an authenticated user
 * whose role is not permitted (never 401 - that's already been handled).
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      // Defensive: should never happen if authenticate() ran first.
      return sendError(res, 401, "unauthorized", "Authentication required.", "authorization");
    }

    if (!allowedRoles.includes(req.user.role)) {
      return sendError(
        res,
        403,
        "forbidden_role",
        `Role '${req.user.role}' is not permitted to perform this action.`,
        "role"
      );
    }

    next();
  };
}

module.exports = { authenticate, requireRole };
