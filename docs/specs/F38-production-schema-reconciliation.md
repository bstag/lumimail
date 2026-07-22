# F38 — Production schema reconciliation

## Current behavior

The Drizzle schema and migration snapshots include multi-user organization and alias tables, but the executable migrations do not create `organizations`, `organization_members`, `aliases`, or `group_members`. They also omit organization ownership columns expected by application queries. A fresh production database therefore reports all migrations applied but first-run registration throws HTTP 500 at organization creation.

## Desired behavior

- A fresh database migrated from the checked-in SQL contains every table and ownership column required by the current Drizzle schema.
- Existing databases created from the incomplete migrations can be upgraded without deleting mail data.
- First-run registration can create an organization, domain, mailbox, membership, and session.

## Decisions

- Add a forward-only reconciliation migration; do not rewrite migrations already recorded in deployed databases.
- Keep new ownership columns nullable so existing rows can be backfilled by the application's existing organization migration logic.
- Preserve all existing tables and data.

## Edge cases and error states

- A failed registration may leave a user row because registration is not transactional.
- Existing rows have null organization ownership until backfilled.
- Foreign-key references from `org_invites` and labels currently point to the missing organizations table.

## Test plan

- Apply all migrations to a fresh local D1 database.
- Verify required tables and columns with `sqlite_master` and `PRAGMA table_info`.
- Run `npm run verify`.
- Apply the reconciliation migration to production and repeat the schema checks.
- Retry first-run registration.

## Bug/Change Log entry draft

- Added a reconciliation migration restoring organization, alias, group-member, and organization-ownership schema omitted from executable migrations.

## Final behavior

- Migration `0007_reconcile_organization_schema.sql` creates the four omitted tables and required indexes.
- It adds nullable `organization_id` foreign-key columns to existing ownership-scoped tables without deleting or rebuilding existing data.
- Both fresh databases and databases that already recorded migrations `0000`–`0006` can advance to the current application schema.

## Verification

- All migrations `0000`–`0007` applied successfully to a fresh local D1 database.
- Local schema inspection confirmed all four tables and ownership columns.
- `npm run verify`: passed (105 files, 845 tests, 100% coverage; existing lint warnings only).
- Production migration `0007` applied successfully (21 statements).
- Read-only production inspection confirmed the new tables and `organization_id` columns.
