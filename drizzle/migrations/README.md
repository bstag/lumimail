# Migrations

Migrations are **hand-written and append-only**:

1. Add the next numbered `NNNN_short_name.sql` file here. Never edit a
   migration that has been applied anywhere — add a new one instead
   (`tests/unit/db/migrations.test.ts` detects edited-in-place migrations).
2. Update `src/db/schema/index.ts` to match. The F42 parity tests verify that
   applying all SQL to a fresh database — and upgrading an older database —
   both reach exact Drizzle-schema parity.
3. Apply with `npm run db:migrate:local` / `npm run db:migrate:remote`
   (wrangler d1 tracks applied migrations in its own `d1_migrations` table).

There is no `drizzle-kit generate` workflow. Its `meta/` snapshots went stale
after migration `0006` and were removed 2026-07-30; regenerating from them
would have produced a wrong mega-migration.
