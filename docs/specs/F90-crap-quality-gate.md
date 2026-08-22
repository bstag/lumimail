# F90 — CRAP Quality Gate

> Status: Implemented
> Owner area: `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `docs/tests/`

## 1. Problem & User Job

Lumimail enforces test coverage, but coverage alone does not identify functions whose
complexity makes them risky to change. Contributors need a repeatable Change Risk
Anti-Patterns (CRAP) report that combines cyclomatic complexity with the coverage
already produced by Vitest.

## 2. User Stories & Acceptance Criteria

- As a contributor, I can run `npm run crap` and receive a concise threshold gate
  that first measures coverage for every executable TypeScript/TSX source file.
- As a contributor, I can run `npm run crap:report` for the full all-source function
  report after the dedicated CRAP coverage pass.
- Given a covered function has a CRAP score above 30, when the CRAP command runs,
  then the command exits non-zero.
- Given CI runs for a push or pull request, when coverage succeeds, then CI runs the
  same CRAP threshold gate.
- Given a function is not exercised by Vitest, when CRAP runs, then the dedicated
  coverage report records zero coverage and the function still receives a score.
- Given an executable source function cannot be attributed coverage, when the full
  report is inspected, then the change is incomplete until that `N/A` is resolved.

## 3. Scope Boundaries

**In scope:**
- TypeScript code analyzed by `@barney-media/crap-typescript`.
- A separate Istanbul JSON coverage pass over `src/**/*.ts` and `src/**/*.tsx`.
- Concise and full-report npm commands, documentation, and a blocking CI step.
- Behavior-preserving helper extraction for existing functions that exceed the
  initial threshold, where required to establish a green baseline.
- Focused tests for risky untested functions when coverage is the appropriate fix.

**Out of scope:**
- The JavaScript IMAP bridge and non-TypeScript assets.
- Broad redesign of existing application modules.
- Persisting a CRAP report or publishing a badge.

## 4. Data Model

N/A — no database changes.

## 5. API Contract

N/A — no application API changes.

## 6. UI/UX

N/A — developer tooling only.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/tooling/crap-config.test.ts` | Package script, dependency, coverage reporter, CI gate, and testing-guide contract |
| Tooling | `npm run crap:coverage` | Produces all-source `coverage/coverage-final.json` without weakening the existing coverage threshold |
| Tooling | `npm run crap` | Regenerates all-source coverage, analyzes every executable function, and enforces the score threshold |
| Integration | `tests/unit/tooling/crap-threshold.test.ts` | Controlled over-threshold fixture exits with analyzer status `2` |
| Full | `npm run verify` | Typecheck, lint, coverage, CRAP, and bridge suites remain green |

No E2E run is required because this change has no user-visible behavior.

## 8. Current Behavior

`npm run crap` now runs a dedicated all-source coverage pass and blocks when any
executable TypeScript/TSX function exceeds 30. Untested source is included at zero
coverage, and the baseline contains no ambiguous `N/A` function mappings. The
ordinary incremental 100%-coverage gate remains unchanged.

## 9. Error States

| Condition | User-visible result | Exit status | Logged? |
|-----------|---------------------|-------------|---------|
| Coverage cannot be generated or read | Analyzer error in the terminal/CI log | Non-zero | Yes |
| One or more functions exceed 30 | Failed function entries in the CRAP report | `2` | Yes |
| Invalid analyzer options | Usage/error output | `1` | Yes |

## 10. Edge Cases

- Declaration, test, generated, dependency, distribution, and coverage files are
  excluded by the analyzer's baseline source-selection rules.
- Declaration files contain no executable functions and remain excluded.
- Untested executable source files are explicitly included in the dedicated coverage
  report and receive zero-coverage scores.
- Coverage-attribution ambiguity is a failure of this feature's completion criteria;
  affected source must be reshaped or the instrumentation corrected.
- The existing `npm run test:cov` 100% include list and thresholds remain unchanged.
- CI runs CRAP only after a successful coverage run, so the JSON report is fresh.
- Generated coverage and CRAP artifacts remain ignored under `coverage/`.
- Empty source selection is invalid and must fail rather than report a vacuous pass.
- Invalid analyzer input and coverage-generation failure stop the command non-zero.
- Coverage and analysis are local deterministic reads; retries do not change results.
- Concurrent CRAP runs may contend for `coverage/`; CI and `verify` run one instance.
- Large reports use failures-only output in the gate and an explicit full-report command.
- Cancellation may leave partial ignored coverage artifacts; the next run cleans them.
- There is no user-visible partial completion, timezone boundary, tenant permission,
  billing, data-loss, mobile, D1/R2/queue, or Cloudflare API behavior.

## 11. Permissions & Security

The analyzer reads repository source and generated local coverage only. It requires
no secrets, network access at runtime, database access, or GitHub write permission.

## 12. Open Questions / Decisions

- Threshold → Use the conventional CRAP threshold of 30 as a blocking initial gate.
  Tightening it later is a separate documented behavior change. Decision: 2026-08-21.
- Integration style → `npm run crap` owns a dedicated all-source coverage pass;
  ordinary fast tests and the existing 100% incremental gate remain unchanged.
  Decision revised: 2026-08-21.
- Coverage scope → Score every executable TypeScript/TSX function under `src/`.
  `N/A` is not accepted for executable source. Decision revised: 2026-08-21.

## 13. Bug / Change Log

### 2026-08-21 — Add TypeScript CRAP reporting and gate

Type: Feature

Summary:
- Add a reproducible CRAP command, Istanbul JSON coverage, CI enforcement, and
  contributor documentation.

Reason:
- Coverage percentage alone does not expose highly complex functions that remain
  risky to modify.

Impact:
- Contributors and CI can identify covered functions above the CRAP threshold of 30.
- Existing violations are split into focused helpers without changing their public
  contracts.

Tests:
- Tooling contract unit test, coverage run, CRAP run, and full verification.

Notes:
- The initial violations were `buildOperationsOverview` (40) and `sendEmail` (38).
  Focused helper extraction reduced the highest current score to 28 without changing
  either public contract.
- This entry records the initial incremental rollout; the all-source expansion below
  supersedes its coverage scope.

### 2026-08-21 — Expand CRAP to every executable source function

Type: Behavior Change

Summary:
- Add a dedicated all-source coverage pass and eliminate every over-threshold or
  unscored executable TypeScript/TSX function.

Reason:
- The incremental unit-coverage report left much of the application unscored, so the
  initial green CRAP result did not represent the whole repository.

Impact:
- CI and `npm run verify` measure all executable TypeScript/TSX functions and fail
  when any score exceeds 30 or cannot be scored.

Tests:
- Tooling configuration contract, controlled threshold failure, focused source
  tests/refactors, full coverage, CRAP, and repository verification.

Notes:
- The repository-wide pass covers every executable `src/**/*.ts` and `src/**/*.tsx`
  function and reports no over-threshold or ambiguous entries.
- The CRAP pass executes 2,661 tests across 306 files. The Wrangler-backed migration
  suite remains in the ordinary coverage gate but is excluded from the duplicate
  instrumentation pass to avoid Windows loopback socket exhaustion.
- A controlled 32-complexity fixture verifies that threshold 30 returns analyzer
  exit status `2`.
- Browser regression verification caught and fixed a presentation regression from
  the members-page extraction: invitation lifecycle labels retain title casing.
