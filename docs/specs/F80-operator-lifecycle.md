# F80 — Operator Lifecycle and Readiness Doctor

> Status: Shipped — local 15/15 and remote 26/26 pass against production with no warnings
> Owner area: `scripts/doctor.mjs`, `docs/OPERATIONS.md`

## 1. Problem & User Job

Lumimail has individually tested deployment, migration, provider, Queue, routing, smoke, and recovery
procedures, but an operator must currently assemble their status from multiple commands and files.
That makes preflight omissions easy and makes a failed deployment harder to diagnose. An operator
needs one non-mutating, content-free command that reports whether the configured installation is
ready and refuses a successful exit when a required check cannot be proven.

## 2. User Stories & Acceptance Criteria

- As an operator, I can run `npm run doctor` before deployment so configuration and local runtime
  errors are found before any remote mutation.
- As an authorized operator, I can run `npm run doctor -- --remote <https-origin>` so Cloudflare
  bindings, migrations, queues, schedules, mail capabilities, secret presence, and public endpoints
  are checked without exposing values or changing resources.
- Given any failed, malformed, skipped-required, or unknown check, the command exits non-zero and
  identifies the check with a safe summary.
- Given every required check passes, the command emits a deterministic JSON report plus concise
  human-readable status and exits zero.
- Reports contain product/runtime/config/resource names, counts, booleans, versions, and timestamps;
  they never contain tokens, cookies, passwords, mail addresses/content, SQL rows, or object keys.

## 3. Scope Boundaries

**In scope:**

- Layer 2.1: Node/package compatibility, production config parsing, exact binding-shape checks,
  migration-file continuity, script/dependency presence, and deterministic aggregation.
- Layer 2.2: read-only Cloudflare Worker/D1/R2/Queue/Email Routing/Sending inventories, required
  secret presence by name only, and complete public smoke. Cron automation proves the exact source
  schedule, the active `scheduled` handler, and the live provider schedule inventory read directly
  from the Cloudflare REST API, because installed Wrangler 4.114 exposes only trigger mutation.
- The smoke check proves the complete public contract rather than a fixed historical count: it
  requires every check to pass and the executed total to equal the boundary-owned expected count, so
  a truncated or reduced run cannot report readiness.
- Machine-readable `pass`, `fail`, and `warn` results with stable check IDs and safe details.
- Fail-closed behavior when provider output is malformed, paginated output is incomplete, or an
  expected resource cannot be uniquely identified.

**Out of scope:**

- Applying migrations, creating/deleting resources, changing routes, deploying, promoting, rolling
  back, sending mail, consuming queues, or writing D1/R2.
- Reading secret values or production mail data.
- A web UI, ordinary application session, or member/admin permission.
- Signed release manifests and promotion gates, which are F81.
- Performance/throughput certification; doctor may report the latest evidence but does not generate
  production load.

## 4. Data Model

No application data or migration changes. Remote D1 checks read migration metadata and schema
identity only; they do not query application rows.

## 5. Command Contract

```text
npm run doctor
node scripts/doctor.mjs --remote https://mail.example.com
```

Remote mode is selected by `--remote <origin>` or by a bare HTTPS origin, because npm and PowerShell
can both strip the flag from `npm run doctor -- --remote <origin>`. Human output names the mode on
its first line so a local report is never mistaken for remote evidence.

Each check returns `{ id, status, summary, observed? }`, where `status` is `pass`, `fail`, or `warn`.
`observed` is limited to content-free scalar values. Output totals must equal the emitted check list.
Remote mode adds provider checks to, rather than replacing, the local checks. Exit code is non-zero
if any required check fails; warnings do not change the exit code.

## 6. UI/UX

No product UI. Human output uses one line per check and a final count. `--json` emits JSON only for
automation. Secret checks name the missing binding but never print its value.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/scripts/doctor.test.ts` | deterministic aggregation, runtime/config/migration checks, safe output, invalid/missing config, malformed provider output, non-mutating command allowlist |
| Existing | `tests/unit/wrangler-config.test.ts` and recovery config tests | exact production/recovery binding invariants reused by doctor |
| Full | repository commands | `npm run verify`; no E2E because F80 has no product UI |
| Operator | remote doctor invocation | read-only inventories and public smoke against the intended origin |

## 8. Current Behavior

`npm run verify` proves code, lint, unit coverage, and bridge behavior. `npm run smoke` proves six
public HTTP contracts. Wrangler commands can inspect each Cloudflare subsystem separately. There is
no single command that connects those checks to the exact configured deployment or emits one
content-free readiness result.

## 9. Error States

| Condition | Operator message | Exit | Logged? |
|-----------|------------------|------|---------|
| Unsupported Node version | runtime requirement not met | non-zero | safe version only |
| Invalid/ambiguous config | exact config check failed | non-zero | field/check ID only |
| Migration gap/duplicate | migration sequence invalid | non-zero | migration prefix only |
| Provider/API failure | named remote check unavailable | non-zero | sanitized provider class |
| Missing secret | required secret name is absent | non-zero | name/presence only |
| Smoke mismatch | public smoke did not pass every check | non-zero | status/count only |
| Live Cron not proven | one fixed class: unproven active version, configuration without exactly one schedule, no usable session or token, provider rejection, unreadable inventory, or schedule mismatch | non-zero | fixed class and count only |
| Optional capability absent | named optional check warns | zero if no failures | safe summary |

## 10. Edge Cases

- Node version below the package requirement or malformed `engines.node`.
- JSONC comments/trailing commas and a missing production config.
- Duplicate, skipped, or non-four-digit migration prefixes.
- Binding arrays inherited/replaced incorrectly by Wrangler environments.
- Multiple D1/R2/Queue resources matching a name, split Worker traffic, or paginated inventories.
- Public origin containing credentials, path, query, fragment, or non-HTTPS protocol.
- Provider output changes shape or includes unsafe error text.
- A secret exists but is empty; report presence semantics only and fail without returning the value.

## 11. Permissions & Security

Local mode needs only repository read access. Remote mode is an operator CLI and uses existing
Cloudflare credentials with read/list capability; no web user can invoke it. Every remote command is
allowlisted as read-only. The live schedule read reuses the operator's own Wrangler session: the
access token is read from the Wrangler auth profile on the operator's machine, used only as a request
header for one read-only endpoint, and never printed, logged, written, or included in the report.
The refresh token is never read. An explicit `CLOUDFLARE_API_TOKEN` takes precedence when present. Reports must be safe to attach to an issue, but operators should still
review them before publication because resource names may reveal deployment topology.

## 12. Open Questions / Decisions

- Decision: local checks ship first and are always executed, even in remote mode. — 2026-08-12
- Decision: a provider check that cannot prove completeness fails rather than warns. — 2026-08-12
- Decision: optional provider choice may warn, but required bindings/secrets for the selected
  provider fail. — 2026-08-12
- Decision: do not infer a live Cron Trigger from source config. Until a read-only provider inventory
  is available, report the exact config plus deployed handler and retain an explicit warning. —
  2026-08-12
- Decision (supersedes the previous line): read the live schedule inventory directly from the
  Cloudflare REST API rather than Wrangler. The absent Wrangler command was a client limitation, not
  a provider limitation, so the earlier warning is replaced by a real pass/fail check. — 2026-08-15
- Decision: the live Cron check fails when no credential for the read is usable, matching the
  existing rule that a provider check which cannot prove completeness fails rather than warns.
  — 2026-08-15
- Decision (supersedes an earlier requirement for `CLOUDFLARE_API_TOKEN`): reuse the operator's
  existing Wrangler login session by reading the access token from the Wrangler auth profile, and
  prefer an explicit `CLOUDFLARE_API_TOKEN` only when one is already set. Requiring a separate token
  for one read is worse than the problem it solves: Wrangler prefers an environment token over an
  interactive session, so introducing one silently re-identifies every other provider check and can
  fail checks that the operator's own login already covered. The token is used as a request header
  only and never enters output. — 2026-08-15
- Decision: run one authenticated Wrangler call before reading the stored session, so an access
  token that expired between runs is refreshed on disk first and a live session is not misreported
  as an absent credential. — 2026-08-15
- Decision: report one fixed failure class for the live Cron check, following the F82 bounded
  operator-failure precedent. A binary fail cannot distinguish an absent credential from a real
  schedule mismatch, which makes the gate unactionable; provider text still never reaches output.
  — 2026-08-15
- Decision: when the active version is unproven, the Cron check reports an unmet dependency and does
  not attempt the schedule read. A passing `remote.version` already proves the scheduled handler, so
  claiming an absent handler from a failed version read would assert something the run never
  observed. — 2026-08-15
- Decision: tolerate both `result.schedules` and a bare `result` array from the provider. A shape
  change should surface as a mismatch or unreadable inventory, never as a false pass. — 2026-08-15
- Decision: the expected public smoke total is owned by the evidence validation boundary rather than
  restated as a literal in the doctor, so extending the public contract cannot silently leave the
  readiness gate asserting a stale count. — 2026-08-15
- Open question: whether the latest recovery/performance evidence should later be read from a signed
  F81 release manifest or a separate operator evidence file.

## 13. Bug / Change Log

### 2026-08-12 — Define the fail-closed operator doctor

Type: Feature

Summary:

- Define local and remote non-mutating readiness contracts, safe output, failure behavior, and
  phased implementation.

Reason:

- Begin the HQBase-inspired operator lifecycle layer after the production-shaped recovery rehearsal.

Impact:

- No runtime or deployment behavior changes in this specification checkpoint.

Tests:

- Documentation-only checkpoint; implementation begins with failing unit tests in Layer 2.1.

Notes:

- F81 owns signed artifacts and deliberate promotion; F80 only observes readiness.

### 2026-08-12 — Implement the local readiness doctor

Type: Feature

Summary:

- Add `npm run doctor` and JSON output for 15 deterministic local readiness checks covering Node,
  Worker identity/origin/compatibility/provider, D1/R2/Queue/Cron/Email/service bindings, contiguous
  migrations, and required operational paths.
- Aggregate every independent failure, exit non-zero on any failure, deeply freeze pure reports, and
  omit account IDs, sender addresses, secret values, and other config contents from observations.

Reason:

- Establish a reliable local preflight before adding read-only provider checks.

Impact:

- The command is non-mutating and makes no network call in local mode.

Tests:

- Six focused unit contracts pass after the module-not-found failure was observed first.
- The real repository report passes 15/15 with migration sequence `0000..0030`.

Notes:

- Remote mode remains unimplemented and must not be inferred from the local ready result.

### 2026-08-12 — Implement and exercise the remote readiness doctor

Type: Feature

Summary:

- Add ten fail-closed remote checks for single-version 100% deployment, active handlers/critical
  bindings, exact D1/R2 identities, zero pending migrations, complete two-page Queue inventory,
  required secret-name presence, Email Routing/Sending readiness, and six public smoke checks.
- Allowlist read-only Wrangler commands and sanitize all provider errors. Reports expose only counts,
  booleans, compatibility/migration/runtime versions, and safe status text.
- Add a distinct Cron warning: source config and the deployed `scheduled` handler are proven, while
  live provider schedule inventory is not claimed.

Reason:

- Turn the manually assembled production-readiness checks into one repeatable operator preflight.

Impact:

- Remote mode reads provider metadata and public endpoints only; it performs no deployment, SQL,
  R2 object, Queue, routing, secret, or sending mutation.

Tests:

- Eleven focused doctor contracts pass, including malformed JSON, pagination, pending migrations,
  missing secrets, provider-error sanitization, failed smoke, and invalid-origin refusal.
- The first live production run passed all 25 implemented pass/fail checks. The final report retains
  one Cron inventory warning rather than overstating provider observation.

Notes:

- F80 can close after the provider Cron schedule is observed through an authorized read surface or
  the warning is explicitly accepted as an operator gate.

### 2026-08-15 — Prove the live Cron schedule and the complete smoke contract

Type: Feature + Bug

Summary:

- Replace the `remote.cron` warning with a real check. The doctor now reads
  `GET /accounts/{account_id}/workers/scripts/{script}/schedules` and requires provider success, an
  empty provider error list, an exact one-to-one match against the configured `triggers.crons`, and
  the already-proven active `scheduled` handler.
- Fix `remote.smoke`, which still required exactly `6/6` after F88 extended the public contract to
  eight checks. The gate now requires every check to pass and the executed total to equal the
  expected count owned by the evidence boundary, so production could not have passed this check as
  written and a future truncated run cannot pass it either.
- Fix the same stale literal in the smoke evidence producer, whose publish-side validation rejected
  any total other than six and therefore refused every real `npm run smoke:record` result.
- Fix `bindings.queues`, which still expected exactly the three mail queues after F88 added the push
  queue and its dead-letter queue. `npm run doctor` reported 14/15 against a correct `wrangler.jsonc`.
  The required binding list now matches the deployed contract and the producer/consumer completeness
  check derives its counts from that list instead of a literal three.
- Add a contract that builds the local report from the committed `wrangler.jsonc` rather than only
  from a test fixture, which is how all three stale literals survived. Extract the existing JSONC
  parser into `tests/helpers/jsonc.ts` so the binding-contract test and this one share it.
- Remove the separate-credential requirement after the third operator run showed why it was wrong.
  Exporting `CLOUDFLARE_API_TOKEN` switches every Wrangler call away from the interactive login
  session, so a narrower token failed seven provider checks that the operator's own login already
  covered. The schedule read now reuses the Wrangler auth profile, warmed by one authenticated
  `wrangler whoami` so an expired access token is refreshed before it is read. An explicit
  environment token still wins, matching Wrangler's precedence.
- Fix the misleading Cron reason from that same run: with the version read failing, the check
  reported an absent scheduled handler it had never observed. It now reports an unmet dependency and
  skips the schedule read entirely.
- Fix a silent mode downgrade found during the first operator run. `npm run doctor -- --remote
  <origin>` can lose the flag to npm or PowerShell argument handling, after which the command ran the
  local report and printed a clean pass with no indication that no provider check had executed.
  Human output now names the mode, a bare HTTPS origin also selects remote mode, and an explicit
  `--remote` without a usable origin stays in remote mode so the run fails instead of downgrading.

Reason:

- The Cron warning existed because Wrangler lacks a read command, not because Cloudflare lacks a
  read API. Removing it closes the last substantive F80 gap.
- The smoke and queue literals were left behind by the F88 push extension and made the readiness
  gate and the evidence producer wrong against the deployed contract. A doctor that fails on a
  correct configuration is worse than no doctor, because operators learn to ignore it.

Impact:

- Remote mode adds one authenticated read-only REST call plus one `wrangler whoami`, and still
  performs no mutation. It needs no credential beyond the operator's existing Wrangler login. The
  session token is used as a request header only; the account identity comes from configuration and
  neither is echoed into the report.

Tests:

- Doctor contracts add live-schedule match, the alternate provider array shape, count mismatch,
  expression mismatch, empty inventory, provider failure envelope, reported provider errors,
  malformed response, non-string entries, unavailable credentials, a throwing reader, absent-handler
  refusal, and refusal of an absent reader before provider access. Each failure asserts its exact
  fixed class.
- Wrangler auth-profile parsing is proven for an unexpired session, an absent expiry, an expired
  session, an empty token, a profile with no token, and a non-string input, plus a contract that the
  refresh token is never returned.
- The smoke gate is proven to fail both a partial run and a complete-but-stale six-check run.
- A producer contract pins the published smoke total to the boundary constant so extending the
  public contract fails loudly instead of silently.
- `npm run doctor` passes 15/15 against the real repository configuration.
- `npm run verify` passes: typecheck, lint with 0 errors and 43 pre-existing warnings, 275 test
  files with 2,381 application tests at 100% statement/branch/function/line coverage, and 21 IMAP
  bridge tests.

Operator evidence 2026-08-15:

- The production run passes 26/26 with zero failures and zero warnings against
  `https://mail.henriksen.dev`, using only the operator's existing Wrangler login session.
  `remote.cron` proves the live schedule for the first time; the previously stale `remote.smoke` and
  `bindings.queues`/`remote.queues` checks pass against the deployed contract.
- Three earlier runs in the same session produced the diagnostic history above: a local report
  mistaken for remote, a live-Cron failure with no actionable reason, and a group provider failure
  caused by an environment token displacing the login session. Each one is fixed and covered by a
  contract.

Notes:

- F80 is complete. The doctor performs no mutation, needs no credential beyond an existing Wrangler
  login, and every check is now pass/fail with no standing warning.
- Remaining F80-adjacent lifecycle work (deliberate upload-then-promote, disposable upgrade
  rehearsal) belongs to F81 and is unaffected by this status change.
