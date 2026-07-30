# Lumimail

Self-hosted, multi-tenant email platform. Next.js 16 (App Router) deployed as a Cloudflare Worker via OpenNext, Drizzle ORM + D1, Tailwind v4, shadcn/Radix UI, TanStack Query, Zod.

There is no separate backend/frontend split — everything lives in `src/`.

## Quick reference

| Concern | Location |
|---------|----------|
| API route handlers | `src/app/api/**/route.ts` |
| Dashboard pages (mailbox-scoped) | `src/app/(dashboard)/` |
| Admin pages (account-scoped) | `src/app/(admin)/` |
| DB schema | `src/db/schema/index.ts` |
| Zod validators | `src/lib/validators.ts` |
| IDs | `src/lib/ids.ts` (nanoid, prefixed) |
| Auth (session cookie) | `src/lib/auth/` |
| Cloudflare API client | `src/lib/cloudflare-api.ts` |
| Email handling | `src/lib/email/` |
| Worker entry | `worker.ts` |
| Drizzle migrations | `drizzle/migrations/` |
| Unit/integration tests | `tests/unit/` (mirrors `src/` paths) |
| E2E tests | `tests/e2e/` (Playwright) |

## Key conventions

- **DB access**: `getDb(env)` returns a Drizzle instance. `env` comes from `getCloudflareContext()`.
- **IDs**: `newId(prefix)` → `prefix_nanoid` format (e.g. `mb_abc123`).
- **Auth**: Session cookie (`ep_session`) with bcrypt-hashed tokens, 30-day expiry. Server-side: `requireUser()` from `src/lib/auth/cookies.ts`. Client-side: `authFetch` from `src/lib/auth/client.ts`. Also supports Bearer token auth for API keys.
- **Validation**: All request bodies validated with Zod schemas in `src/lib/validators.ts`.
- **Cross-tenant isolation**: Every query that reads/writes mailbox, message, domain, or routing data must filter by the authenticated user. New endpoints must have a cross-tenant denial test.
- **Migrations are hand-written**: add the next numbered `.sql` file in `drizzle/migrations/` (append-only, never edit an applied migration) and update `src/db/schema/index.ts` to match. `tests/unit/db/migrations.test.ts` verifies the SQL produces exact Drizzle-schema parity on fresh and upgraded databases. There is no `drizzle-kit generate` workflow.
- **i18n**: 11 locales via `next-intl`, RTL support for Arabic. Messages in `src/i18n/messages/`.

## Commands

```bash
npm run dev             # Next.js dev server
npm run typecheck       # tsc --noEmit
npm run lint            # next lint
npm run test            # vitest run
npm run test:watch      # vitest watch
npm run test:cov        # vitest --coverage (100% gate on included files)
npm run e2e             # playwright test
npm run verify          # typecheck + lint + test:cov
npm run db:migrate:local  # wrangler d1 migrations apply --local
npm run db:migrate:remote # wrangler d1 migrations apply --remote
```

## Engineering protocol

This project follows a **spec-first, test-driven, verification-first** workflow. The full protocol is in `docs/ENGINEERING.md`. The mandatory lifecycle:

```text
Spec → Tests → Implementation → Verification → Spec Update
```

Before writing any implementation code:
1. Read the feature spec in `docs/specs/F<NN>-<slug>.md` (or create it from `docs/specs/TEMPLATE.md`)
2. Check the feature registry in `docs/MVP_SCOPE.md`
3. Write failing tests first
4. Implement the minimal change
5. Run `npm run verify` (and `npm run e2e` for user-visible changes)
6. Update the spec and registry

Never skip the spec because a change seems small. Never modify tests just to make them pass. Never claim verification that wasn't actually performed.
