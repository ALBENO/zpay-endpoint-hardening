const express = require("express");
const { sendError } = require("../lib/apiError");
const { idempotencyStore, transactionStore } = require("../lib/store");
const { authenticate, requireRole } = require("../middleware/auth");
const { rateLimit } = require("../middleware/rateLimit");

const router = express.Router();

const MAX_AMOUNT_INR = 100000; // ₹1,00,000

/**
 * Resolves the charge amount from the request body, supporting both the
 * legacy `amount_inr` field and the new `amount` field.
 *
 * Rule: if only `amount_inr` is sent, use it. If both are sent, `amount`
 * wins. This keeps v1 backward compatible while the client population
 * migrates to the new field name.
 */
function resolveAmount(body) {
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    return body.amount;
    // v2: remove amount_inr fallback
  }
  if (body.amount_inr !== undefined && body.amount_inr !== null && body.amount_inr !== "") {
    return body.amount_inr;
    // v2: remove amount_inr fallback
  }
  return undefined;
}

/**
 * POST /v1/payments
 *
 * Order of checks (after auth + rate limit middleware has already run):
 *   1. Field presence / type validation           -> 400
 *   2. Idempotency-Key replay / conflict check     -> 200 (cached) or 400
 *   3. Business rule: max amount                   -> 422
 *   4. Duplicate transaction_ref                   -> 409
 *   5. Process + persist + cache                   -> 201
 */
router.post(
  "/v1/payments",
  authenticate,
  rateLimit,
  requireRole("operator", "admin"), // viewers may read, not create, payments
  (req, res) => {
    const body = req.body || {};

    const amount = resolveAmount(body);
    const transactionRef = body.transaction_ref;
    const idempotencyKey = req.headers["idempotency-key"];

    // --- 1. Field validation ------------------------------------------------
    if (amount === undefined) {
      return sendError(
        res,
        400,
        "missing_field",
        "The 'amount' field is required (or 'amount_inr' for legacy clients).",
        "amount"
      );
    }

    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      return sendError(
        res,
        400,
        "invalid_field",
        "The 'amount' field must be a positive number.",
        "amount"
      );
    }

    if (!transactionRef || typeof transactionRef !== "string") {
      return sendError(
        res,
        400,
        "missing_field",
        "The 'transaction_ref' field is required and must be a string.",
        "transaction_ref"
      );
    }

    // --- 2. Idempotency-Key handling ----------------------------------------
    if (idempotencyKey) {
      const cached = idempotencyStore.get(idempotencyKey);

      if (cached) {
        if (cached.amount === amount) {
          // Exact replay: return the original response untouched, no
          // duplicate payment is created.
          return res.status(cached.status).json(cached.body);
        }

        return sendError(
          res,
          400,
          "idempotency_key_reuse_mismatch",
          "This Idempotency-Key was already used with a different amount.",
          "Idempotency-Key"
        );
      }
    }

    // --- 3. Business rule: maximum amount -----------------------------------
    if (amount > MAX_AMOUNT_INR) {
      return sendError(
        res,
        422,
        "amount_limit_exceeded",
        `Amount exceeds the maximum allowed value of ₹${MAX_AMOUNT_INR.toLocaleString("en-IN")}.`,
        "amount"
      );
    }

    // --- 4. Duplicate transaction_ref check ---------------------------------
    if (transactionStore.has(transactionRef)) {
      return sendError(
        res,
        409,
        "transaction_already_processed",
        `A payment with transaction_ref '${transactionRef}' has already been processed.`,
        "transaction_ref"
      );
    }

    // --- 5. Process payment (mocked) -----------------------------------------
    const payment = {
      id: `pay_${transactionRef}`,
      transaction_ref: transactionRef,
      amount,
      currency: "INR",
      status: "succeeded",
      created_by: req.user.id,
      created_at: new Date().toISOString(),
    };

    transactionStore.set(transactionRef, payment);

    const responseBody = { payment };

    if (idempotencyKey) {
      idempotencyStore.set(idempotencyKey, {
        amount,
        status: 201,
        body: responseBody,
      });
    }

    return res.status(201).json(responseBody);
  }
);

module.exports = router;
