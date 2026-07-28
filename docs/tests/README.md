# Testing Guide

Lumimail's test goal is **100% coverage on every file under `src/` that contains
logic**, reached incrementally, plus E2E coverage of every critical user journey.
TDD is mandatory per `docs/ENGINEERING.md`.

## Layout

```
tests/
  unit/        # Vitest — mirrors src/ paths
    lib/
    app/
    components/
    db/
  e2e/         # Playwright — user journeys against `npm run dev`
```

`tests/unit/<path>` mirrors `src/<path>`. Example:
`src/lib/validators.ts` → `tests/unit/lib/validators.test.ts`.

## Commands

```bash
npm run test          # vitest run (no coverage gate, fast loop)
npm run test:watch    # vitest watch mode
npm run test:cov      # vitest run --coverage (enforces 100% on included files)
npm run typecheck     # tsc --noEmit
npm run e2e           # playwright test (boots `npm run dev`)
npm run verify        # typecheck + lint + test:cov
```

## Coverage strategy: grow the include list, never lower the threshold

`vitest.config.ts` sets `coverage.thresholds` to 100% for lines, functions,
statements, and branches — but only across `coverage.include`. This keeps the
gate honest while the suite is built out incrementally:

1. Pick a file under `src/` that lacks tests.
2. Write `tests/unit/<mirrored-path>.test.ts` covering all its branches.
3. Add the file's path to `coverage.include` in `vitest.config.ts`.
4. Run `npm run test:cov` — it must stay green at 100%.
5. Repeat until `coverage.include` covers all of `src/`, then switch `include`
   to `["src/**/*.ts", "src/**/*.tsx"]` (excluding generated files like
   `cloudflare-env.d.ts`, `src/db/migrations`, and `*.d.ts`).

Never add a file to `include` before it has tests, and never remove a passing
file from `include` to make the gate pass.

## What to test where

- **Pure functions / utils / validators** (`src/lib/`, `src/app/utils.ts`,
  `src/components/**/*-utils.ts`): unit tests, no mocking needed.
- **API route handlers** (`src/app/api/**/route.ts`): integration tests that call
  the exported `GET`/`POST`/etc. handlers directly with a `Request` and a test D1
  database (use `drizzle-orm/d1` against `wrangler`'s local Miniflare D1, or an
  in-memory equivalent). Cover: success, validation failure (400), unauthenticated
  (401), cross-tenant access (403/404), not found (404).
- **React components/hooks**: unit tests with `@testing-library/react` for logic
  and rendered output; avoid testing implementation details (internal state
  shape, CSS classes used only for styling).
- **Critical user journeys**: Playwright E2E in `tests/e2e/`. At minimum: landing
  page, register → onboarding → dashboard, login, send/receive a message, add a
  domain (mocked Cloudflare API), API key create/use.

## E2E setup

E2E tests boot `npm run dev` (Playwright `webServer`). For flows touching
Cloudflare APIs (`CF_TOKEN`), either:

- Run against a `.dev.vars` with a real scoped token against a disposable test
  zone, or
- Mock `src/lib/cloudflare-api.ts` at the network boundary (e.g. via an MSW
  server) so domain/mailbox E2E tests don't depend on live Cloudflare state.

Document which mode a given E2E test uses in a comment at the top of the file.

## Two E2E suites, and why both exist

```
tests/
  e2e/         # Playwright, every API response mocked
  e2e-local/   # Playwright, real backend and real sessions
```

`tests/e2e/` mocks every API response. It verifies that the UI renders what it is
handed, quickly and without any data setup. It cannot verify that the server would
hand it that — a mock returning `role: "viewer"` proves nothing about who the
server considers a viewer. Hidden controls are not a security boundary.

`tests/e2e-local/` signs in as real users against a real local database and asserts
on real authorization. Run it with:

```bash
npm run e2e:local
```

That seeds `scripts/seed-e2e.mjs` first. The fixture's shape is deliberate:

| Mailbox | Owner | Member | Viewer |
|---------|-------|--------|--------|
| `alpha` | manager | — | — |
| `shared` | manager | responder | viewer |
| `private` | manager | **no row** | — |

`private` makes "cannot reach a mailbox they were not granted" testable; the viewer
on `shared` makes "can read it but still cannot send from it" testable. Neither
question can be asked without the corresponding fixture, so do not simplify them
away.

Sessions are established once per role by `auth.setup.ts` and reused while they
still resolve. Logging in per test tripped the five-attempt-per-minute limiter,
which was the limiter working correctly against a bad test pattern.

### Mock every request the shell makes

`authFetch` treats a 401 as a lost session: it clears the token and navigates to
`/login`. In `tests/e2e/`, a shell request left unmocked therefore tears the page
down partway through the test, and the failure surfaces wherever the redirect lands
— a detached element, an aborted navigation, an assertion against `/login`. None of
those point at the missing mock, and because it races the assertion it looks
intermittent.

`tests/e2e/shell.ts` mocks the requests every dashboard route makes. Call
`mockShellNoise(page)` before a spec's own routes, which still take precedence. If
a mocked test fails in a way that mentions `/login` or a detached element, log
401 responses first — the cause is almost certainly a request nothing mocked.

### When a run fails with "You are offline"

That page is the PWA's cached offline shell, not an application error, and it means
the dev server is not answering. It is easy to misread as an authentication failure —
sign-in appears to hang, and the saved session looks expired.

The usual cause is a dead server that still owns `.next/dev`: the record claims a PID,
so starting another server is refused, while nothing is actually listening on the
port. The service worker then answers navigations from cache.

Check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` — a
`000` means nothing is listening. Remove `.next/dev` and start the server again.

## Definition of "done" for a feature's tests

- [ ] Every new/changed file in `src/` is in `coverage.include` and at 100%.
- [ ] Every new API route has: success, validation, auth, and cross-tenant tests.
- [ ] Every new user-visible flow has an E2E test covering happy path + one
      failure/empty/loading state.
- [ ] `npm run verify` and `npm run e2e` pass locally.
