/**
 * All state below is in-memory and process-local. This is intentional per the
 * assignment ("You may mock: database operations, cache storage, token
 * validation, transaction storage"). In production these maps would be
 * replaced by Redis (idempotency + rate limiting) and a real DB (transactions).
 */

// --- Mocked auth: token -> user record ------------------------------------
// Real implementation would validate a JWT / call an auth provider.
const TOKENS = new Map([
  ["token-admin-1", { id: "user_admin_1", role: "admin" }],
  ["token-operator-1", { id: "user_operator_1", role: "operator" }],
  ["token-viewer-1", { id: "user_viewer_1", role: "viewer" }],
]);

function validateToken(token) {
  return TOKENS.get(token) || null;
}

// --- Idempotency cache: idempotencyKey -> { requestHash, response, status } ---
const idempotencyStore = new Map();

// --- Processed transaction refs: transaction_ref -> response payload -----
const transactionStore = new Map();

// --- Rate limiting: userId -> { count, windowStart } ----------------------
const rateLimitStore = new Map();

module.exports = {
  validateToken,
  idempotencyStore,
  transactionStore,
  rateLimitStore,
};
