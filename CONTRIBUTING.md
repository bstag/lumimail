# Contributing to Lumimail

Thanks for wanting to make email a little more open. This guide gets a **human or an AI coding agent** from clone to merged PR with no surprises. If you only read one other file, read [`AGENTS.md`](./AGENTS.md) — it is the canonical contract for how work is done here.

---

## TL;DR

```bash
git clone https://github.com/cschanhniem/lumimail && cd lumimail
cp .dev.vars.example .dev.vars      # fill in CF_TOKEN (see README → Setup)
npm install
npm run db:migrate:local
npm run dev                         # http://localhost:3000

# before every PR:
npm run verify                      # typecheck + lint + test:cov (100% on touched files)
npm run e2e                         # only for user-visible changes
```

- **Node 22** (matches CI).
- One logical change per PR. Small, reversible, reviewable.
- Spec first, tests first, then implement. See below.

---

## The non-negotiable lifecycle

This project is **spec-first and test-driven**. The full protocol lives in [`docs/ENGINEERING.md`](./docs/ENGINEERING.md); the short version:

```text
Spec → Tests (failing) → Implementation → Verification → Spec update
```

1. **Spec.** Find or create `docs/specs/F<NN>-<slug>.md` from [`docs/specs/TEMPLATE.md`](./docs/specs/TEMPLATE.md). Define current behavior, desired behavior, edge cases, error states, and a test plan. Check the registry in [`docs/MVP_SCOPE.md`](./docs/MVP_SCOPE.md).
2. **Tests.** Write failing tests in `tests/unit/` (mirrors `src/` paths) and `tests/e2e/` for user-visible flows. Run them — they must fail for the right reason.
3. **Implement** the smallest correct change. Prefer explicit behavior over clever abstraction. Do not add libraries unless the spec requires it.
4. **Verify** with `npm run verify` (and `npm run e2e` when relevant). Never claim a check passed without running it.
5. **Update the spec** to match final behavior and update `docs/MVP_SCOPE.md` if scope changed.

> Never skip the spec because the change "seems small." Never weaken or delete a failing test to make CI green.

---

## Project conventions (read before writing code)

| Concern | Rule |
|---------|------|
| DB access | `getDb(env)` returns Drizzle; `env` from `getCloudflareContext()`. |
| IDs | `newId(prefix)` → `prefix_nanoid` (e.g. `mb_abc123`). See `src/lib/ids.ts`. |
| Auth | Server: `requireUser()` (`src/lib/auth/cookies.ts`). Client: `authFetch` (`src/lib/auth/client.ts`). Bearer tokens for API keys. |
| Validation | Every request body validated with a Zod schema in `src/lib/validators.ts`. |
| **Cross-tenant isolation** | **Every** query touching mailbox / message / domain / routing data MUST filter by the authenticated user. Every new endpoint needs a cross-tenant denial test. This is a security invariant, not a style choice. |
| i18n | 11 locales via `next-intl`. New user-facing strings go in `src/i18n/messages/`. RTL must work (Arabic). |
| Immutability | Return new objects; don't mutate inputs in place. |
| File size | Keep files focused (< 800 lines). Extract modules when they grow. |

See [`CLAUDE.md`](./CLAUDE.md) / [`AGENTS.md`](./AGENTS.md) for the full codebase map.

---

## Commit & PR format

- **Conventional commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
- Branch off `main`; open the PR against `main`.
- Fill in the PR template. Link the spec (`docs/specs/F<NN>-...`) and the issue.
- CI (`npm run verify`) must be green before review.

---

## For AI agents specifically

You are a first-class contributor here. To work effectively:

- **Start at [`AGENTS.md`](./AGENTS.md)** — it encodes default behavior, rules, ambiguity handling, and the codebase map in agent-ready form.
- **Pick work from [`docs/AGENT_TASKS.md`](./docs/AGENT_TASKS.md)** — a curated, self-contained task surface sized for autonomous PRs.
- **Verification is your contract.** A change is "done" only when `npm run verify` passes. Report exactly what you ran, what passed, and what you did *not* verify.
- **When blocked by ambiguity**, add an "Open Questions" section to the spec and make the safest reversible assumption — unless it touches security, billing, permissions, data loss, or a user-visible contract, in which case stop and ask.
- **Stay in scope.** No drive-by refactors, no new dependencies, no reformatting unrelated files.

---

## Reporting bugs & requesting features

Use the GitHub issue templates. A good bug report includes: what you expected, what happened, repro steps, and environment. A sharp issue is itself a valuable contribution.

## Security

Do **not** open public issues for vulnerabilities. See [`SECURITY.md`](./SECURITY.md).

## License & CLA

Contributions are under **AGPL-3.0**. By contributing you agree to the [Contributor License Agreement](./CLA.md), which keeps copyright consolidated so the project can remain both open source and commercially sustainable.
