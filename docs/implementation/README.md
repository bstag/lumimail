# Implementation Plans

Execution-ready plans for unbuilt features and decided reworks. Each plan is
written so an agent can ship the work end-to-end without asking questions: which
files to read first, which tests to write first, which files to create/change,
exact verification commands, and what "done" means.

## How these plans relate to the rest of the docs

| Layer | File | Answers |
|-------|------|---------|
| WHAT & WHY | `docs/specs/F<NN>-*.md` | Product contract: behavior, acceptance criteria, boundaries |
| HOW & IN WHAT ORDER | `docs/implementation/P<NN>-*.md` (this folder) | PR breakdown, files, tests, commands, checklists |
| PROCESS | [docs/ENGINEERING.md](../ENGINEERING.md) | The lifecycle every PR follows |
| STATUS | [docs/MVP_SCOPE.md](../MVP_SCOPE.md) | Registry — update in the same PR |
| TESTING | [docs/tests/README.md](../tests/README.md) | Where tests live, how to run them |

If a plan and its spec disagree, **the spec wins** — fix the plan in the same PR
and note it in the spec's Bug/Change Log.

## Plan index

| Plan | Feature(s) | Spec(s) | Status |
|------|-----------|---------|--------|
| _none yet_ | | | Add plans here as work is scoped |

## Execution protocol (every PR in every plan)

This is [ENGINEERING.md](../ENGINEERING.md) in checklist form. Plans assume it;
they don't repeat it.

1. **Load context** — read the files in the plan's "Context to load" table. Don't
   skip; don't read more than listed.
2. **Tests first** — write the failing tests listed in the PR section
   (`tests/unit/...`, `tests/e2e/...`). Run them; confirm they fail for the right
   reason.
3. **Implement** — smallest change that makes them pass, following existing
   patterns in `src/`.
4. **Verify**:
   ```bash
   npm run verify   # typecheck + lint + vitest --coverage (100% on touched files)
   npm run e2e      # for user-visible changes
   ```
5. **Docs in the same PR** — spec (Current Behavior + Bug/Change Log entry),
   `docs/MVP_SCOPE.md` registry row.
6. **Report** — use the format in `ENGINEERING.md` §3 Step 9.

## Conventions plans assume

- **Routes:** new API routes go under `src/app/api/<resource>/route.ts` (and
  `[id]/route.ts` for item routes), following the existing handlers' shape
  (parse with Zod from `src/lib/validators.ts`, `getDb(env)`, session check via
  `src/lib/auth/`).
- **Pages:** dashboard (mailbox-scoped) pages go in `src/app/(dashboard)/`, admin
  (account-scoped) pages in `src/app/(settings)/(org)/`.
- **IDs:** `newId(prefix)` from `src/lib/ids.ts`.
- **Schema changes:** add a Drizzle migration in `drizzle/migrations/` via
  `npm run db:generate`, then `npm run db:migrate:local`.
- **Tests:** unit/integration tests in `tests/unit/`, mirroring `src/` paths
  (e.g. `src/lib/validators.ts` → `tests/unit/lib/validators.test.ts`); E2E in
  `tests/e2e/`.
- **Branch naming:** `feat/p<NN>-pr<M>-<slug>` (e.g. `feat/p07-pr1-webhook-retry`).
  Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`).
- **Every new API endpoint gets a cross-tenant access test.** No exceptions.

## When a plan turns out to be wrong

Plans are derived documents. If reality contradicts a plan (file moved, API
differs, better approach found): follow the spec, fix the plan file in the same
PR, and record the deviation in the spec's Bug/Change Log. Never silently diverge.
