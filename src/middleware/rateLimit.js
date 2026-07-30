const { sendError } = require("../lib/apiError");
const { rateLimitStore } = require("../lib/store");

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 50;

/**
 * Simple fixed-window rate limiter, keyed per authenticated user.
 * Must run after `authenticate` (needs req.user.id).
 *
 * This is intentionally a plain in-memory Map so the mobile app's automatic
 * retries during network failures, and the batch-script traffic spike
 * scenario described in the brief, are both bounded per-user rather than
 * globally - one noisy client/script cannot starve other users' quota.
 *
 * A fixed window (vs. sliding/token-bucket) is a deliberate simplicity
 * trade-off for this assignment; swap for Redis + a sliding window or
 * token-bucket algorithm in production for smoother enforcement at window
 * boundaries.
 */
function rateLimit(req, res, next) {
  if (!req.user) {
    return sendError(res, 401, "unauthorized", "Authentication required.", "authorization");
  }

  const userId = req.user.id;
  const now = Date.now();
  const existing = rateLimitStore.get(userId);

  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    // Start a fresh window for this user.
    rateLimitStore.set(userId, { count: 1, windowStart: now });
    return next();
  }

  if (existing.count < MAX_REQUESTS_PER_WINDOW) {
    existing.count += 1;
    return next();
  }

  // Limit exceeded - compute remaining time in the current window.
  const retryAfterSeconds = Math.ceil((existing.windowStart + WINDOW_MS - now) / 1000);
  res.set("Retry-After", String(Math.max(retryAfterSeconds, 1)));

  return sendError(
    res,
    429,
    "rate_limit_exceeded",
    `Too many requests. Limit is ${MAX_REQUESTS_PER_WINDOW} requests per minute per user.`,
    null
  );
}

module.exports = { rateLimit };
