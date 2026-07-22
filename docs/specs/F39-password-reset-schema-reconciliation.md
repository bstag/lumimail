# F39 — Password reset schema reconciliation

> Status: Shipped
> Owner area: `drizzle/migrations/`, `src/app/api/auth/forgot-password`, `src/app/api/auth/reset-password`

## 1. Problem & User Job

Lumimail's Drizzle schema, generated snapshots, and password-reset routes depend on `password_reset_tokens`, but no executable SQL migration creates that table. A fresh or upgraded D1 database can report every migration applied while forgot-password and reset-password requests fail at runtime.

Users need password recovery to work against the database produced by the checked-in migration SQL.

## 2. User Stories & Acceptance Criteria

- As a user with a configured reset email, I can request and consume a password-reset token without a missing-table database error.
- Given an empty D1 database, when all checked-in migrations are applied, then `password_reset_tokens` exists with the columns, defaults, primary key, and cascading user foreign key declared by Drizzle.
- Given an existing deployment at migration `0007`, when the new migration is applied, then the missing table is added without rebuilding or deleting existing tables.
- Given the executable SQL omits the table, when the migration contract test runs, then it fails even if Drizzle snapshots still contain the table.

## 3. Scope Boundaries

**In scope:**

- A forward-only D1 migration that creates `password_reset_tokens`.
- A regression test covering the executable migration contract.
- Fresh local D1 and existing production D1 verification.

**Out of scope:**

- Changing the forgot-password or reset-password API contract.
- Delivering password-reset email; the current route only returns a development link and intentionally does not send one in production.
- The comprehensive schema-drift detector tracked as R-06.

## 4. Data Model

| Table | Columns touched | Notes |
|---|---|---|
| `password_reset_tokens` | `id`, `user_id`, `token_hash`, `expires_at`, `used`, `created_at` | New executable migration for an already-declared Drizzle table; `user_id` cascades on user deletion. |

The table has no secondary indexes in the current Drizzle schema. This change must match the schema rather than introducing an undocumented index.

## 5. API Contract

No API response changes. Existing routes become executable against a migrated D1 database:

| Method | Route | Auth | Change |
|---|---|---|---|
| POST | `/api/auth/forgot-password` | Public | No longer fails because its insert target is absent. |
| POST | `/api/auth/reset-password` | Public | No longer fails because its token query target is absent. |

## 6. UI/UX

No UI changes.

## 7. Test Plan

| Layer | File or command | What it covers |
|---|---|---|
| Unit contract | `tests/unit/db/migrations.test.ts` | Executable SQL includes the complete table definition and foreign key. |
| Route unit | Existing auth route tests | Forgot/reset behavior remains unchanged. |
| D1 integration | `wrangler d1 migrations apply DB --local` on a fresh state | SQLite accepts all migrations and exposes the expected table metadata. |
| Full verification | `npm run verify` | Typecheck, lint, coverage, and regression suite. |
| Production | Pending local success | Apply only the pending migration remotely, then inspect table metadata read-only. |

E2E is not required because this repair changes only persistence infrastructure and the existing production reset flow does not send reset email.

## 8. Current Behavior

- `src/db/schema/index.ts` declares `passwordResetTokens`.
- Drizzle snapshots contain the table.
- Executable migrations `0000` through `0007` do not create it.
- Mocked route tests do not detect the missing physical table.

## 9. Error States

| Condition | User-visible result | HTTP status | Logged? |
|---|---|---|---|
| Table absent | Generic internal-server failure | 500 | Runtime error logging |
| Migration already applied | No pending migration | N/A | Wrangler output |
| Migration SQL rejected | Deployment must stop before application rollout | N/A | Wrangler output |

## 10. Edge Cases

- Existing users and sessions must remain untouched.
- Deleting a user must cascade to that user's reset tokens.
- `used` must default to SQLite integer `0` and remain non-null.
- Applying the migration through Wrangler's migration journal must occur once.
- No token values or hashes may be emitted during schema verification.

## 11. Permissions & Security

- This migration changes no authorization behavior.
- Reset tokens and token hashes must not be included in verification output or committed documentation.
- Production verification is limited to schema metadata.

## 12. Open Questions / Decisions

- Decision: add a forward-only migration rather than modifying historical migrations, because production has already recorded them. — 2026-07-22
- Decision: preserve the schema's current lack of secondary indexes; broader query/index analysis belongs to the performance pass. — 2026-07-22

## 13. Bug / Change Log

### 2026-07-22 — Restore executable password reset schema

Type: Bug Fix

Summary:

- Add the `password_reset_tokens` table missing from executable D1 migrations.
- Add a regression test against migration SQL so snapshot-only schema changes cannot conceal this table again.

Reason:

- Password recovery otherwise fails at runtime on correctly migrated deployments.

Impact:

- Existing deployments receive one new table; existing data is preserved.

Tests:

- Migration contract test, fresh local D1 application and metadata inspection, full verification, then production application and metadata inspection.

Notes:

- Added `0008_add_password_reset_tokens.sql` as a forward-only migration matching the current Drizzle declaration.
- The regression test failed before the migration and passed after it was added.
- All migrations `0000` through `0008` applied successfully to an isolated fresh local D1 state.
- Local schema metadata confirmed all six columns, the primary key, the `used` default, and the cascading user foreign key.
- `npm run verify` passed: 106 test files, 846 tests, and 100% reported coverage; lint reported 43 pre-existing warnings and no errors.
- Production reported only `0008` pending. It applied successfully, and read-only production metadata inspection confirmed the expected table, columns, and foreign key.
- E2E was not run because this migration does not change the interface and production reset-email delivery remains outside this spec.
