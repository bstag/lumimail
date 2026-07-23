# F44 — API-Key Revocation and Lifecycle Controls

> Status: Shipped
> Owner area: `src/app/api/api-keys/`, `src/app/(admin)/api-keys/`, `src/lib/api/auth.ts`, `src/db/schema/`

## 1. Problem & User Job

Lumimail users can create and authenticate API keys, but cannot revoke them. The UI leaves a generated secret visible without a clear one-time-secret lifecycle and does not show creation or last-use activity. Hard deletion alone would remove useful audit metadata, and the current authentication sequence can authorize a key that is revoked while bcrypt verification is in progress because its final `lastUsedAt` update is not checked.

Users need to understand, audit, and permanently revoke their own programmatic credentials without affecting another user or tenant.

## 2. User Stories & Acceptance Criteria

- As a user, I can see each key's prefix, scopes, creation time, last-use time, and active/revoked state.
- As a user, I can permanently revoke one of my active keys after explicit confirmation.
- Given a key belongs to another user, when I attempt to revoke its identifier, then the API returns the same not-found response as an unknown key and changes nothing.
- Given a key is revoked before authentication's final claim, when the request continues, then authentication fails and `lastUsedAt` is not treated as a successful claim.
- Given a key is already revoked, when it is presented or revoked again, then it cannot authenticate or become active again.
- A newly created full secret is displayed in a dedicated one-time dialog, clearly warns that it cannot be recovered, and never appears in list responses.
- Unit, migration, and browser tests cover ownership, repeat revocation, immediate authentication failure, last-use visibility, and one-time secret handling.

## 3. Scope Boundaries

**In scope:**

- Nullable `revoked_at` lifecycle timestamp and forward-only migration.
- User-scoped `DELETE /api/api-keys/[id]` that permanently revokes rather than erases audit metadata.
- Authentication exclusion and concurrency-safe final claim for revoked keys.
- UI confirmation, status, created/last-used/revoked timestamps, and one-time secret dialog.
- Clear success and error feedback.

**Out of scope:**

- Restoring/reactivating a revoked key.
- Editing a key name or scopes.
- Organization-admin revocation of another user's keys.
- Full security-event audit log beyond retained key lifecycle timestamps.
- Automatic expiration or rotation scheduling.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `api_keys` | new nullable `revoked_at` timestamp | `NULL` means active; a timestamp means permanently revoked. Existing keys remain active. |
| `api_keys` | `created_at`, `last_used_at` | Exposed only as lifecycle metadata to the owning user. |

Migration `0009_add_api_key_revocation.sql` adds the nullable column without rebuilding or deleting existing keys.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/api-keys` | Session owner | — | `{ apiKeys: [{ id, name, prefix, scopes, createdAt, lastUsedAt, revokedAt }] }` | 401 |
| POST | `/api/api-keys` | Session owner | `{ name, scopes }` | `{ id, name, prefix, key }` | 400, 401 |
| DELETE | `/api/api-keys/[id]` | Session owner | — | `{ ok: true }` | 401, 404 for unknown, other-user, or already-revoked key |

The raw full key is returned only from successful POST and is never returned by GET or DELETE.

## 6. UI/UX

- Creation opens a separate result dialog containing the secret, a one-time warning, copy action, and explicit Done action.
- Closing the result dialog clears the full secret from React state.
- Active key cards show created and last-used metadata and a Revoke action.
- Revoked key cards show a revoked badge and revocation timestamp with no restore action.
- Revoke requires confirmation naming the affected key and explains that the action is permanent.
- Mutation errors remain visible and do not optimistically mark a failed revocation complete.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Migration | `tests/unit/db/migrations.test.ts` | Fresh D1 contains `api_keys.revoked_at` through the comprehensive schema contract. |
| API | `tests/unit/app/api/api-keys/[id]/route.test.ts` | Authentication, owner success, unknown/other-user/already-revoked not-found behavior. |
| Auth | `tests/unit/lib/api/auth.test.ts` | Revoked candidates are excluded and a revoke during verification makes the final claim fail. |
| UI utility | `tests/unit/app/(admin)/api-keys/` | Lifecycle formatting and revoke request contract. |
| E2E | `tests/e2e/api-key-lifecycle.spec.ts` | One-time secret dialog, lifecycle metadata, confirmation, successful revoke, and error state. |

## 8. Previous Behavior

- POST creates a bcrypt-hashed key and returns its full secret.
- GET lists only non-secret metadata, including `lastUsedAt`, but the UI does not render timestamps.
- There is no revoke route or UI action.
- Authentication selects by prefix and verifies bcrypt, then performs an unchecked `lastUsedAt` update; concurrent deletion would not prevent the already-loaded candidate from authorizing.
- The created secret remains in a page card until navigation/reload and is not clearly described as unrecoverable.

## 9. Error States

| Condition | User-visible result | HTTP status | Logged? |
|-----------|---------------------|-------------|---------|
| Unauthenticated lifecycle request | Existing sign-in redirect/unauthorized behavior | 401 | Existing auth policy |
| Unknown, other-user, or already-revoked key | API key not found | 404 | No sensitive details |
| Revocation storage failure | Revoke failed; active UI state retained | 5xx | Platform error reporting |
| Clipboard unavailable | Secret remains selectable; copy error shown | N/A | No |

## 10. Edge Cases

- Existing rows receive `revoked_at = NULL` and remain usable.
- Prefix collisions continue to scan candidates, but revoked rows are excluded before bcrypt work.
- Authentication performs a conditional `lastUsedAt` update with `revoked_at IS NULL` and requires a returned row before authorizing.
- Revocation is permanent and repeat requests return 404 without changing the original timestamp.
- A revoked key remains visible to its owner for audit but never exposes its hash or full secret.
- A full secret is cleared when its dialog closes and cannot be retrieved from GET.
- `lastUsedAt = null` is displayed as Never.

## 11. Permissions & Security

- Lifecycle routes use the session-authenticated user ID and constrain every mutation by both key ID and `user_id`.
- Organization roles do not grant access to another member's personal API keys.
- Other-user identifiers are indistinguishable from unknown identifiers.
- Revoked key rows are filtered before verification and conditionally rechecked at the authorization point.
- `key_hash` and full keys are never returned in list or revoke responses.

## 12. Open Questions / Decisions

- Decision: retain revoked records with `revokedAt` rather than hard-delete so creation, last-use, and revocation history remain visible. — 2026-07-22
- Decision: use DELETE as the permanent revoke action; revoked keys cannot be restored. — 2026-07-22
- Decision: revocation remains user-scoped; broader organization credential administration requires an explicit permissions design. — 2026-07-22
- Decision: preserve the existing API-key route response style in this bounded change rather than mixing lifecycle work with a full legacy API-envelope migration. — 2026-07-22

## 13. Bug / Change Log

### 2026-07-22 — Add API-key lifecycle controls

Type: Security Fix

Summary:

- Add permanent user-scoped revocation, lifecycle audit metadata, concurrency-safe authentication, and explicit one-time secret handling.

Reason:

- Compromised or unused credentials currently cannot be disabled through Lumimail.

Impact:

- Owners can audit and permanently disable their own keys; revoked credentials fail authentication immediately.

Tests:

- Migration, API, authentication, UI utility, browser, and full verification suites.

Notes:

- 30 focused lifecycle tests, the fresh-migration schema contract, and two Chromium browser scenarios pass.
- `npm run verify` passes with 919 tests and 100% configured statement, branch, function, and line coverage.
- OpenNext build and Wrangler dry run pass; migration `0009` is applied to production D1 and remote inspection confirms `revoked_at`.
- Worker `158f8558-5c94-4849-aceb-730e7e56fae5` is deployed; the production page returns HTTP 200 and an unauthenticated revoke returns 401.
- Controlled production UI validation confirmed that revoking a disposable key changes its state from Active to Revoked, displays the revocation timestamp, and removes the Revoke action. No key material is recorded here.
