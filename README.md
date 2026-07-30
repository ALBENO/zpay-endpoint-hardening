# zpay-endpoint-hardening

A hardened implementation of `POST /v1/payments` for ZPay, focused on the
HTTP contract and reliability behaviour (not infrastructure): structured
errors, idempotency/retry safety, per-user rate limiting, and backward
compatible request versioning.

Branch: `hardened-contract`

## Stack

Plain Express.js. All persistence (auth tokens, idempotency cache,
transaction store, rate limit counters) is mocked with in-memory `Map`s in
`src/lib/store.js`, as permitted by the assignment.

## Local setup

```bash
npm install
npm start
# -> zpay-endpoint-hardening listening on port 3000
```

Requires Node.js 18+.

## Mocked auth tokens

Since no real auth provider is wired up, three tokens are pre-seeded in
`src/lib/store.js`:

| Token              | Role     |
|--------------------|----------|
| `token-admin-1`     | admin    |
| `token-operator-1`  | operator |
| `token-viewer-1`    | viewer   |

Only `operator` and `admin` may create payments. `viewer` is authenticated
but gets a `403`.

## curl examples

### 1. Missing amount -> 400

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Content-Type: application/json" \
  -d '{"transaction_ref": "txn_001"}'
```

### 2. Missing/invalid auth -> 401

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "transaction_ref": "txn_002"}'
```

### 3. Authenticated but wrong role -> 403

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-viewer-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "transaction_ref": "txn_003"}'
```

### 4. Amount exceeds ₹1,00,000 -> 422

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 150000, "transaction_ref": "txn_004"}'
```

### 5. Successful payment -> 201

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "transaction_ref": "txn_005"}'
```

### 6. Duplicate transaction_ref -> 409

```bash
# Run the txn_005 request from above twice - the second call returns 409.
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "transaction_ref": "txn_005"}'
```

### 7. Idempotency-Key replay (same amount) -> cached 201, no duplicate charge

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Idempotency-Key: idem-abc-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 750, "transaction_ref": "txn_006"}'

# Retry with the same key + same amount -> identical cached response
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Idempotency-Key: idem-abc-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 750, "transaction_ref": "txn_006"}'
```

### 8. Idempotency-Key reused with a different amount -> 400

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Idempotency-Key: idem-abc-123" \
  -H "Content-Type: application/json" \
  -d '{"amount": 999, "transaction_ref": "txn_007"}'
```

### 9. Rate limit -> 429 after 50 requests/min for one user

```bash
for i in $(seq 1 60); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/v1/payments \
    -H "Authorization: Bearer token-operator-1" \
    -H "Content-Type: application/json" \
    -d "{\"amount\": 10, \"transaction_ref\": \"txn_rate_$i\"}"
done
# First 50 succeed (201), remaining return 429 with a Retry-After header.
```

### 10. Legacy `amount_inr` field still works -> 201

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Content-Type: application/json" \
  -d '{"amount_inr": 250, "transaction_ref": "txn_legacy_001"}'
```

### 11. Both `amount` and `amount_inr` sent -> `amount` wins

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 300, "amount_inr": 999999, "transaction_ref": "txn_both_001"}'
# Charges 300, not 999999.
```

## Error response shape

Every error follows:

```json
{
  "error": {
    "code": "error_code_slug",
    "param": "field_name",
    "message": "human readable message"
  }
}
```

`param` is `null` for errors not tied to a specific field (e.g. rate limiting).

## Assumptions

- **`transaction_ref` is required.** The brief didn't explicitly list a 400
  for a missing `transaction_ref`, but the 409 "already processed" check is
  meaningless without a stable business-level identifier to key on, so it's
  validated as a required string field (400 `missing_field` if absent).
- **Role restriction on payment creation.** The brief mentions `viewer`,
  `operator`, and `admin` roles without stating which can create payments. I
  assumed `viewer` is read-only and only `operator`/`admin` can create
  charges, since that's the realistic mapping for a payments API. This is
  isolated in `requireRole("operator", "admin")` in
  `src/routes/payments.js` and easy to change.
- **Idempotency scope.** The `Idempotency-Key` cache compares only `amount`
  for conflict detection (matching the spec's "same key + different amount
  -> 400"). In a real system you'd likely hash the whole normalized request
  body to also catch changes to `transaction_ref` or other fields, but the
  amount check is what the spec calls out explicitly.
- **Idempotency is optional.** If a client doesn't send `Idempotency-Key`,
  the request is processed normally and is only protected against
  duplication via the `transaction_ref` 409 check, not via replay caching.
- **Rate limiting is a fixed 60-second window per user**, reset from the
  first request in that window (not a sliding window/token bucket). This
  is simple and matches "max 50 requests per minute per authenticated
  user," but has the usual fixed-window edge effect (a burst at the
  boundary between two windows could briefly exceed 50/min). Noted as a
  known trade-off, not a bug.
- **Ordering of checks** in the route is: auth (401) -> rate limit (429) ->
  role (403) -> body validation (400) -> idempotency replay/conflict (200
  cached / 400) -> amount limit (422) -> duplicate transaction_ref (409) ->
  success (201). This ordering means rate-limited requests are rejected
  before role/business checks run, so a single noisy client can't burn
  extra CPU cycles on validation logic once it's over quota.
- **All state is in-memory and per-process**, as explicitly allowed by the
  assignment. Restarting the server clears all payments, idempotency
  cache, and rate-limit counters. This would be swapped for Redis (rate
  limiting + idempotency) and a real datastore (transactions) in
  production.
- **Auth tokens are hardcoded** in `src/lib/store.js` as a stand-in for a
  real token validation/auth provider call, per "You may mock: ...
  token validation."

## Project structure

```
src/
  app.js                    # Express app wiring, JSON parsing, error fallbacks
  server.js                 # Entrypoint (app.listen)
  lib/
    apiError.js              # Structured error response helper
    store.js                 # Mocked in-memory stores (auth, idempotency, transactions, rate limit)
  middleware/
    auth.js                  # authenticate() + requireRole()
    rateLimit.js              # Per-user fixed-window rate limiter
  routes/
    payments.js               # POST /v1/payments handler
```
