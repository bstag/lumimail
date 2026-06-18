<!--
Thanks for contributing to Lumimail! Keep PRs small and focused — one logical change.
Humans and AI agents: see CONTRIBUTING.md and AGENTS.md before opening.
-->

## What & why

<!-- What does this change and why? Link the issue and the spec. -->

- Closes #
- Spec: `docs/specs/F<NN>-<slug>.md`

## Type of change

- [ ] `fix` — bug fix
- [ ] `feat` — new feature
- [ ] `refactor` — no behavior change
- [ ] `docs` / `test` / `chore` / `perf` / `ci`

## Checklist

- [ ] Followed the spec → tests → implementation → verification lifecycle (`docs/ENGINEERING.md`)
- [ ] Spec added/updated under `docs/specs/` and `docs/MVP_SCOPE.md` if scope changed
- [ ] Added failing tests first, then made them pass (did not weaken existing tests)
- [ ] `npm run verify` passes locally (typecheck + lint + test:cov)
- [ ] `npm run e2e` passes (for user-visible changes) — or N/A
- [ ] Any query touching mailbox/message/domain/routing data filters by the authenticated user, with a cross-tenant denial test
- [ ] No new dependencies, or they are justified in the spec
- [ ] User-facing strings added to `src/i18n/messages/` (and RTL-safe) — or N/A

## What was NOT verified

<!-- Be honest. Anything you couldn't test, edge cases left open, manual steps required. -->
