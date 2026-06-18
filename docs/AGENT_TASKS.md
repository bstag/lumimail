# Agent task surface

A curated menu of work sized for a single autonomous PR. Each entry is **self-contained**: a fresh agent should be able to pick one, follow the lifecycle in [`AGENTS.md`](../AGENTS.md), and open a mergeable PR without further context.

> Before starting any task: read [`AGENTS.md`](../AGENTS.md), skim the relevant spec in [`docs/specs/`](./specs/), and confirm `npm run verify` is green on a clean checkout.

## How to claim a task

1. Open (or comment on) the matching GitHub issue so work isn't duplicated.
2. Follow the lifecycle: **spec → failing tests → implementation → `npm run verify` → spec update**.
3. Keep the PR to one logical change. Link the spec and the issue.

## Task sizing legend

- 🟢 **Starter** — localized, low-context, great first PR.
- 🟡 **Standard** — touches one feature area; needs spec familiarity.
- 🔴 **Deep** — cross-cutting; coordinate via an issue first.

---

## 🟢 Starter tasks

- **i18n coverage audit.** Verify all 11 locales in `src/i18n/messages/` have keys present in the `en` base. Add missing keys (translate or mark for translation). RTL must still render for Arabic. *Verify:* `npm run verify`, manual locale switch.
- **Test-coverage gaps.** Run `npm run test:cov` and find included files below 100%. Add focused unit tests in `tests/unit/` (mirror the `src/` path). Do not change implementation.
- **Validator hardening.** Pick a Zod schema in `src/lib/validators.ts` and add a missing-edge-case test (boundary lengths, malformed input). Tighten the schema only if a test exposes a real gap — document it in the relevant spec.
- **Docs drift.** Cross-check the API table in `README.md` against actual `src/app/api/**/route.ts` handlers. Fix mismatches.

## 🟡 Standard tasks

- **New API endpoint cross-tenant test.** For any endpoint missing one, add a test proving a user cannot read/write another tenant's data. This is a security invariant — see `SECURITY.md`.
- **Error-state UX.** Pick a dashboard flow (compose, folder move, domain add) and ensure failures surface a user-friendly message rather than a silent failure or raw error. Add an e2e assertion.
- **IMAP/SMTP bridge robustness.** See [`imap-bridge/`](../imap-bridge/README.md). Add tests for an under-covered command path; fix protocol edge cases against the F13 spec (`docs/specs/F13-imap-smtp-bridge.md`).

## 🔴 Deep tasks (open an issue first)

- **Performance pass** on message list pagination / search for large mailboxes — measure before/after, keep queries bounded (no N+1).
- **Accessibility sweep** of the webmail UI — keyboard nav, focus states, reduced-motion, contrast.
- **New feature** from `docs/MVP_SCOPE.md` marked planned — write the `F<NN>` spec from `docs/specs/TEMPLATE.md` first and get it reviewed before implementing.

---

## Guardrails (apply to every task)

- Every query touching mailbox / message / domain / routing data **must** filter by the authenticated user.
- No new dependencies unless the spec justifies them.
- No unrelated refactors or reformatting.
- A task is done only when `npm run verify` passes (and `npm run e2e` for user-visible changes). Report what you ran and what you did not verify.
