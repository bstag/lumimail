# F80 — Operator Lifecycle and Readiness Doctor

> Status: In Progress — local and remote doctor implemented; live Cron inventory remains operator-proven
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
  secret presence by name only, and six-check public smoke. Cron automation proves the exact source
  schedule and active `scheduled` handler; provider-side schedule inventory remains a warning because
  installed Wrangler 4.114 exposes only trigger mutation, not a read command.
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
npm run doctor -- --remote https://mail.example.com
```

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
| Smoke mismatch | public smoke did not pass 6/6 | non-zero | status/count only |
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
allowlisted as read-only. Reports must be safe to attach to an issue, but operators should still
review them before publication because resource names may reveal deployment topology.

## 12. Open Questions / Decisions

- Decision: local checks ship first and are always executed, even in remote mode. — 2026-08-12
- Decision: a provider check that cannot prove completeness fails rather than warns. — 2026-08-12
- Decision: optional provider choice may warn, but required bindings/secrets for the selected
  provider fail. — 2026-08-12
- Decision: do not infer a live Cron Trigger from source config. Until a read-only provider inventory
  is available, report the exact config plus deployed handler and retain an explicit warning. —
  2026-08-12
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
- The real repository report passes 15/15 with migration sequence `0000..0028`.

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
