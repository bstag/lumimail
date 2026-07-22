# F42 — Executable Schema Drift Detection

> Status: Shipped
> Owner area: `drizzle/migrations/`, `tests/unit/db/`, `.github/workflows/ci.yml`

## 1. Problem & User Job

Lumimail previously allowed the Drizzle schema and snapshot metadata to advance while the executable D1 migration SQL remained incomplete. Builds and ordinary unit tests could pass, but a fresh deployment then failed when application code queried missing tables or columns.

Maintainers need CI to prove that the database produced by the checked-in SQL migrations has the same application-visible tables, columns, indexes, and foreign keys as the checked-in Drizzle schema.

## 2. User Stories & Acceptance Criteria

- As a maintainer, I can run one verification command and know that a fresh local D1 database matches the application schema.
- Given an empty isolated local D1 state, when the migration check runs, then Wrangler applies every executable migration successfully.
- Given the migrated database, when its schema is compared with Drizzle, then application tables, columns, indexes, and foreign keys match exactly after documented normalization.
- Given a required executable table, column, index, or foreign-key statement is removed while Drizzle remains unchanged, when the check runs, then it fails with a useful structural diff.
- Given CI or `npm run verify`, when normal verification runs, then schema drift detection runs automatically.

## 3. Scope Boundaries

**In scope:**

- A fresh, isolated Wrangler local-D1 migration run.
- Structural comparison against `src/db/schema/index.ts`.
- Tables, columns (name/type/nullability/primary-key status), declared indexes (name/uniqueness/ordered columns), and foreign keys (source/target columns, target table, update/delete actions).
- Automatic execution from the repository verification path and CI.
- Unit regressions proving mismatches are detected independently of migration snapshots.

**Out of scope:**

- Comparing production data or mutating the production D1 database.
- Proving upgrade safety for every historical production data shape.
- Comparing SQLite implementation indexes or internal Cloudflare tables.
- Treating default-expression text as an exact cross-engine contract; SQLite may normalize equivalent default syntax.

## 4. Data Model

No application schema changes. The expected contract is derived directly from every table exported by `schema` in `src/db/schema/index.ts`. The actual contract is read from the fresh migrated local D1 database.

## 5. API Contract

No HTTP API changes.

## 6. UI/UX

No user-interface changes.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/db/schema-contract.test.ts` | A missing table, column, index, or foreign key produces a drift failure without consulting snapshots. |
| Integration | `tests/unit/db/migrations.test.ts` | Wrangler applies all SQL migrations to empty local D1 state and the resulting structure matches Drizzle. |
| CI | `npm run verify` and `.github/workflows/ci.yml` | The fresh-database contract is part of ordinary verification. |

E2E is not required because this is build/deployment tooling with no user-visible flow.

## 8. Current Behavior

The Vitest suite creates an isolated Wrangler persistence directory, applies every executable migration to an empty local D1 database, reads the resulting SQLite structure, and compares it with the live Drizzle table objects. Because GitHub CI runs `test:cov`, the same contract now gates local `npm run verify` and pull requests.

## 9. Error States

| Condition | Result | Logged? |
|-----------|--------|---------|
| A migration cannot be applied | Check fails with Wrangler output | CI/test output |
| Migrated structure differs from Drizzle | Check fails with the missing/unexpected structure | CI/test output |
| Local database cannot be found or inspected | Check fails before comparison | CI/test output |

## 10. Edge Cases

- D1's `d1_migrations`, `sqlite_sequence`, and SQLite-generated auto-indexes are excluded.
- Composite index column order is significant.
- Foreign-key comparison is order-independent, but each source-to-target column mapping and action is significant.
- SQLite type names and referential actions are normalized to stable case.
- The isolated persistence directory is removed after success or failure.
- Migration snapshots are intentionally not an input to the expected contract.

## 11. Permissions & Security

- The check runs only against a temporary local D1 state.
- It needs no Cloudflare credentials and must never select application data or expose secrets.
- No tenant or authorization behavior changes.

## 12. Open Questions / Decisions

- Decision: derive expectations from the live Drizzle table objects, not snapshot JSON, so a valid snapshot cannot hide missing executable SQL. — 2026-07-22
- Decision: use Wrangler to apply migrations, then inspect Wrangler's local SQLite database, so the check exercises the same migration runner developers use for D1. — 2026-07-22
- Decision: keep this in the Vitest suite so `test:cov`, `verify`, and current CI all enforce it without a second CI-only path. — 2026-07-22

## 13. Bug / Change Log

### 2026-07-22 — Add comprehensive executable schema verification

Type: Bug Fix

Summary:

- Replace the single-table SQL regex guard with a fresh local-D1 structural contract.
- Detect table, column, index, and foreign-key drift against Drizzle automatically.

Reason:

- Snapshot-only schema changes previously reached production with required executable SQL missing.

Impact:

- Migration drift blocks local verification and CI before deployment.

Tests:

- Unit mismatch regressions and a real isolated Wrangler migration run.

Notes:

- The regression suite was observed failing before the schema-contract helper existed.
- Seven focused schema tests pass, including real Wrangler migration application and missing table/column/index/foreign-key cases.
- `npm run verify` passes with 887 tests and 100% configured coverage.
- The fresh migrated database currently has no structural differences from Drizzle.
- E2E was not run because this change has no user-visible behavior.
