# F06 — API Keys

> Status: Shipped
> Owner area: `src/app/api/api-keys/`, `src/app/api/v1/`, `src/app/(admin)/api-keys/`, `src/lib/api/auth.ts`

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

## 8. Known Gaps

- No PATCH route (can't rename or change scopes)
- No single-key GET route

## 9. Bug / Change Log

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.

### 2026-07-22 — Add API-key lifecycle controls

Type: Security Fix. See [F44](./F44-api-key-lifecycle.md) for the full behavior, threat boundary, and verification evidence.
