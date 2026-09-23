# F06 — API Keys

> Status: Shipped
> Owner area: `src/app/api/api-keys/`, `src/app/api/v1/`, `src/app/(settings)/(org)/api-keys/`, `src/lib/api/auth.ts`

## 1. Problem & User Job

Users need programmatic access to send and read email. API keys with scoped permissions provide
an alternative to session cookies for CI/CD, scripts, and integrations.

## 2. User Stories & Acceptance Criteria

- As a user, I can create an API key with `send` + `read` scopes.
  - Given I enter a name and click create, a key is generated and shown once.
- As a user, I can list my existing API keys (prefix + name + scopes).
- As a user, I can see creation, last-use, and revocation status for my keys.
- As a user, I can permanently revoke my own active key after confirmation.
- As an API consumer, I can send email via `/api/v1/send` with a valid API key.

## 3. Scope Boundaries

**In scope:** Create API key (send+read scopes), list lifecycle metadata, permanently revoke keys, and send via v1 API. Detailed revocation behavior is specified in [F44](./F44-api-key-lifecycle.md).

**Out of scope:** Restore revoked keys, update key name/scopes, read mail via v1 API, custom scopes.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `apiKeys` | `id`, `userId`, `organizationId`, `name`, `prefix`, `keyHash`, `scopes`, `createdAt`, `lastUsedAt`, `revokedAt` | Revoked rows are retained for lifecycle visibility. |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/api-keys` | `guardUser` | — | `{ apiKeys: [{ id, name, prefix, scopes, createdAt, lastUsedAt, revokedAt }] }` | 401 |
| POST | `/api/api-keys` | `guardUser` | `{ name, scopes }` | `{ id, name, prefix, key }` | 401, 400 |
| DELETE | `/api/api-keys/[id]` | `guardUser` | — | `{ ok: true }` | 401, 404 |

### v1 Send

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/v1/send` | Bearer API key | `{ from, to, subject, html?, text? }` | `{ messageId }` | 401, 403, 400, 429 |

## 6. UI/UX

- `/api-keys` — card grid: name, prefix (`ep_key_abcdef...`), scope/status badges, and lifecycle timestamps
- "New API key" dialog: name input, then a dedicated one-time secret dialog with copy and unrecoverable-secret warning
- Active keys expose a revoke action with permanent-action confirmation; revoked keys remain visible without a restore action
- Empty state: "No API keys yet"

## 7. Current Behavior

- `generateApiKey()` creates a nanoid prefixed `ep_key_`, bcrypt-hashes it, stores `keyHash` + `prefix`
- `authenticateApiKey()` looks up active keys by prefix (first 12 chars), verifies the hash, and conditionally claims `lastUsedAt` only while the key remains active
- `requireScope()` checks scope array contains required scope or `*`
- User-scoped DELETE permanently timestamps `revokedAt`; unknown, other-user, and already-revoked IDs return the same 404
- `/api/v1/send` delegates to the shared outbound producer, which applies the
  durable per-user quota of 50 ordinary sends per hour. A valid API key is
  subject to the same quota as browser and SMTP sends; an exhausted quota is
  HTTP 429 and unavailable quota storage fails closed with HTTP 503.
- API-key sends do not perform a second route-level quota check. Automatic
  vacation replies are internal and exempt, while MCP action sends use the
  producer's one shared check and idempotent replays do not consume another
  slot. See [F05](./F05-compose-send.md).

## 8. Known Gaps

- No PATCH route (can't rename or change scopes)
- No single-key GET route

## 9. Error States

| Condition | Result |
|-----------|--------|
| Missing, revoked, or scope-incomplete key | Existing `401 Unauthorized` response; the producer is not called. |
| Invalid or unauthorized sender | Existing non-enumerating `404 Mailbox not found` response. |
| Per-user ordinary-send quota exhausted | Existing JSON error envelope with `Send rate limit exceeded` and HTTP 429. |
| Durable quota storage unavailable | Existing JSON error envelope with `Service temporarily unavailable` and HTTP 503; no message is accepted. |

## 10. Bug / Change Log

### 2026-09-05 — Apply shared outbound quota to API-key sends

Type: Security / Abuse-control bug fix.

`/api/v1/send` now reaches the same durable 50-per-hour producer quota as
browser sends, which also covers the SMTP bridge because it calls this route.
The route preserves its auth, validation, response envelope, and sender
non-enumeration behavior while mapping quota exhaustion to 429 and quota-store
failure to 503. The shared producer owns the check so API and browser callers
cannot drift or charge one request twice.

Verification: quota exhaustion/storage-failure route regressions pass. Integrated
`npm run verify` passes with 2,713 application tests, 100% configured coverage,
the complexity gate, and 21 bridge tests. All 105 browser tests pass. Deployed 2026-09-06; see [F08 rollout evidence](./F08-webhooks.md).

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.

### 2026-07-22 — Add API-key lifecycle controls

Type: Security Fix. See [F44](./F44-api-key-lifecycle.md) for the full behavior, threat boundary, and verification evidence.
