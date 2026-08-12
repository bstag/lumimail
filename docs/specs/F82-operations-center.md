# F82 — Read-only Operations Center

> Status: In Progress — content-free evidence-history slice deployed and boundary-verified
> Owner area: `src/lib/operations.ts`, `src/app/api/admin/operations/`, `src/app/(admin)/operations/`

## 1. Problem & User Job

Lumimail already records queue health and can inspect R2 retention, but owners must visit separate
surfaces or run operator commands to answer whether the installation is healthy. An organization
owner needs one safe overview that summarizes current application/schema identity, persisted queue
state, and retention integrity without opening Cloudflare, exposing secrets, or triggering cleanup.

## 2. User Stories & Acceptance Criteria

- As an organization owner, I can open `/operations` and see application/schema identity, aggregate
  queue state, and sanitized R2 retention state with explicit observation timestamps.
- As an admin or member, I cannot see the navigation item, page, or API response.
- Loading or refreshing the overview performs reads only. It never runs a queue check, deletes an R2
  object, deploys, migrates, restores, sends mail, or invokes an operator command.
- The API never returns R2 object keys, messages, addresses, secret values/names, provider errors,
  account IDs, or raw caught errors.
- One unavailable subsystem remains visible as unavailable without hiding safely available sections.
- As an owner, I can see the newest recovery, signed-release, public-smoke, and traced-mail-flow
  evidence recorded for my organization without seeing artifact contents or operator credentials.
- Trusted operator tooling can append a fixed-shape evidence result only through an exact recently
  authenticated owner session. An organization can neither write nor read another organization's
  evidence.

## 3. First-slice Contract

- `GET /api/admin/operations` is owner-only and uncached by the default dynamic route behavior.
- Application version comes from the package manifest; schema version comes from the committed
  release schema policy.
- Queue summary reads persisted snapshots only through `readQueueHealthSnapshots`; it does not call
  `runQueueHealthCheck`. It reports counts, backlog totals, stale jobs, latest check time, and an
  aggregate `healthy`, `attention`, `unavailable`, or `unknown` status.
- Retention summary calls the existing read-only report and removes its object-key sample. It reports
  scanned/orphan counts, orphan bytes, oldest orphan timestamp, and `healthy`, `attention`, or
  `unavailable` status.
- Overall status is unavailable when a subsystem cannot be read, attention when a safe observation
  needs action or has never run, and healthy only when both sections are healthy.

## 4. UI/UX

- Add owner-only Operations navigation and an Operations card to the admin overview.
- Use the existing page header/card/status-token system. Show loading, unavailable, empty/never-run,
  and fresh-data states without a mutation button.
- Link detailed queue diagnostics to the existing owner-only `/queue-health` page.
- No object-key samples or destructive retention controls appear in this slice.
- Add one Operational evidence card with fixed Recovery, Signed release, Public smoke, and Mail flow
  rows. Each row shows only outcome, passed/total checks, observation time, and recording freshness.
- Missing evidence is visibly `Not recorded`; ingestion, retry, cleanup, deploy, restore, signing,
  and send controls do not appear on the page.

### Second-slice runtime readiness contract

- Inspect the Worker environment in-process without network calls and report only five category
  booleans: storage (D1 + R2), queues (inbound + outbound + DLQ), outbound provider, service self-
  reference, and assets/images.
- Report only the normalized provider family (`cloudflare`, `resend`, or `unsupported`) plus required,
  ready, and missing binding counts. Never return binding names, resource IDs/names, account IDs,
  secret names/values, sender addresses, origins, or arbitrary configuration values.
- Cloudflare delivery is configured only when the Email Sending binding exists. Resend delivery is
  configured only when its secret is non-empty; the value is never retained or returned. Unknown
  providers fail closed as unsupported.
- This is configuration presence, not a live provider probe. The existing remote doctor remains the
  authoritative provider-inventory check.

### Third-slice operational evidence contract

- Add `operational_evidence` in migration `0032`. Each row stores only organization/actor ownership,
  one fixed category (`recovery`, `release`, `smoke`, or `mail_flow`), one fixed outcome (`passed` or
  `failed`), bounded passed/total check counts, the evidence observation timestamp, and the server
  recording timestamp. There is no arbitrary payload, detail, filename, URL, commit, resource ID,
  address, message identifier, provider response, token, or free-text column.
- `POST /api/admin/operations/evidence` accepts the strict versioned
  `lumimail-operations-evidence-v1` shape. It requires an organization owner and the exact current
  session to have been password-confirmed within the existing recent-authentication window.
- `passedChecks` and `totalChecks` are integers from 0/1 through 1,000, `passedChecks` cannot exceed
  `totalChecks`, a `passed` outcome requires equality, and a `failed` outcome requires at least one
  failed check. `observedAt` must be valid UTC and cannot be in the future or more than 90 days old.
- `(organization, category, observedAt)` is immutable and unique. An exact replay is idempotent; a
  conflicting replay receives `409` and cannot rewrite history.
- The evidence row itself is the content-minimized audit record: actor, organization, and server
  recording time are retained but not returned by the Operations read model. There is no update or
  delete endpoint. A D1 trigger atomically retains only the newest 200 rows per organization.
- The overview reads at most the newest 200 rows in the authenticated owner's organization and
  exposes only the newest row per category. No evidence is `unknown`, a read failure is
  `unavailable`, any failed latest result is `attention`, and all four latest results passing is
  `healthy`. Unknown/failed evidence contributes attention to overall status; unavailable evidence
  makes overall status unavailable.
- Updating the schema also advances the exact signed-release schema policy from stale `0030` to
  `0032`; production already has invitation lifecycle migration `0031`.

## 5. Error and Privacy States

| Condition | Result |
|-----------|--------|
| Anonymous/admin/member request | Standard 401/403 response before reads |
| Queue snapshots absent | Queue status `unknown`; zero safe counts |
| Queue read fails | Queue status `unavailable`; retention may still render |
| Retention read fails | Retention status `unavailable`; queues may still render |
| Orphans exist | Retention status `attention`; counts/bytes only |
| Provider/storage exception contains private text | Text is discarded and never returned |
| Required runtime binding absent | Readiness status `unavailable`; category and count only |
| Unsupported outbound provider | Provider `unsupported`; no raw configured value returned |
| Evidence body has unknown/additional fields | `400`; no write |
| Owner session is not recently confirmed | `403`; no evidence read/write attempt |
| Evidence timestamp is future or older than 90 days | `400`; no write |
| Exact evidence replay | Existing record retained; successful idempotent response |
| Same category/timestamp with different result | `409`; existing record retained |
| Evidence read fails | Evidence status `unavailable`; other safe sections still render |
| Evidence belongs to another organization | Neither read nor conflict detection can observe it |

## 6. Test Plan

| Layer | Coverage |
|-------|----------|
| Unit `tests/unit/lib/operations.test.ts` | aggregation, timestamps, degraded sections, no sample/error leakage, immutable report |
| Unit `tests/unit/lib/operational-evidence.test.ts` | recent-auth boundary, validation window, tenant scope, idempotency/conflict, bounded read model |
| Route `tests/unit/app/api/admin/operations/route.test.ts` | owner guard, exact response, no reads after denial |
| Route `tests/unit/app/api/admin/operations/evidence/route.test.ts` | strict body, exact-session recent auth, 201/idempotent/409/error envelopes |
| Migration `tests/unit/db/operational-evidence-migration.test.ts` | content-free columns, unique/index/retention trigger, fresh and upgrade parity |
| E2E `tests/e2e/operations.spec.ts` | owner navigation/page, healthy and attention states, sanitized rendering |
| E2E restricted navigation | admin/member direct-route redirect and hidden owner-only link |
| Full | `npm run verify` and `npm run e2e` |

## 7. Scope Boundaries and Later Slices

The first two slices do not persist evidence. The third slice adds only a server-authorized,
content-free result ledger and read model; it does not upload or parse source artifacts and cannot
claim that an operator result is cryptographically derived from those artifacts. Adapters that
translate each existing script's successful output into the fixed ingestion contract, live Cron
inventory, and additional integrity observations remain later work. All other mutations remain
separate, recently authenticated, confirmed, audited, and explicitly specified.

## 8. Decisions

- Decision: reuse existing health/retention services; do not duplicate provider logic. — 2026-08-12
- Decision: omit retention object-key samples even though the detailed API currently exposes them to
  owners. Aggregate health does not require private storage topology. — 2026-08-12
- Decision: partial read failure returns a successful sanitized overview with an unavailable section
  instead of turning other safe evidence into a page-wide error. — 2026-08-12
- Decision: first slice is owner-only because queue and platform storage health are deployment-wide,
  not organization-admin data. — 2026-08-12
- Decision: scope persisted evidence by organization even though runtime health is deployment-wide.
  This preserves Lumimail's mandatory tenant boundary and prevents one owner from manufacturing or
  enumerating another owner's evidence. — 2026-08-12
- Decision: authorize ingestion with the existing recent-authenticated owner session rather than a
  new long-lived deployment secret. This slice creates no credential distribution or rotation
  problem. — 2026-08-12
- Decision: store fixed enums, counts, and timestamps instead of JSON. Privacy is structural rather
  than dependent on every producer remembering to redact a payload. — 2026-08-12
- Decision: evidence results are trusted operator assertions. Cryptographically binding smoke,
  recovery, and mail-flow claims to source artifacts is not implied by this slice. — 2026-08-12

## 9. Bug / Change Log

### 2026-08-12 — Specify the sanitized operations overview

Type: Feature

Summary:

- Define the owner-only read model, privacy boundary, aggregate states, UI states, and negative tests
  for the first Operations Center slice.

Impact:

- Specification only at this checkpoint; implementation begins with failing tests.

### 2026-08-12 — Implement the first owner-only Operations Center slice

Type: Feature

Summary:

- Add an owner-only `/api/admin/operations` read model and `/operations` page with application/schema,
  persisted queue, and sanitized R2-retention summaries.
- Preserve partial evidence when one subsystem fails; discard caught errors and R2 object-key samples.
- Add owner-only navigation/admin-overview entries, queue-detail linkage, status/loading/error states,
  and direct-route denial for members and organization admins.

Reason:

- Let an owner answer the first platform-health questions without opening Cloudflare or invoking a
  mutation.

Impact:

- Read operations only. No queue check, object deletion, deploy, migration, restore, send, provider
  mutation, signing, upload, or promotion path was added.

Tests:

- Five focused service/route contracts pass, including denial-before-read, aggregate states,
  independent subsystem failure, immutability, and privacy.
- Six focused browser scenarios pass for owner rendering and restricted navigation.
- Full verification passes 1,890 tests with 100% statement/branch/function/line coverage and all 21
  IMAP bridge tests; the complete mocked Chromium suite passes 74 scenarios.

Notes:

- Current F81 schema compatibility is exact (`0030`), so this slice presents its maximum as the
  current schema. If compatibility widens, F82 must read the installed D1 migration head instead.
- Deployed as Worker version `a6af68c4-e135-4bb3-9c96-a7a12af2b703` on 2026-08-12 with no pending
  migrations. The production build included `/operations` and `/api/admin/operations`; public smoke
  passed 6/6, the new API refused an anonymous caller with `401`, and the remote doctor passed 25
  checks with the one documented live-Cron-inventory warning. Authenticated owner rendering remains
  covered by the production-shaped browser suite rather than a production-session automation.

### 2026-08-12 — Add sanitized runtime binding and provider readiness

Type: Feature

Summary:

- Add a fourth Operations card for storage, queue, outbound-delivery, self-service, and asset/image
  binding categories with configured/required/missing totals.
- Normalize outbound provider identity to Cloudflare, Resend, or unsupported and require the selected
  provider's runtime capability without returning binding or secret names/values.
- Fold missing runtime configuration into overall unavailable status while preserving queue and
  retention evidence.

Reason:

- Let owners distinguish application/data health from an incomplete runtime deployment without
  exposing deployment topology or credentials.

Impact:

- In-process environment presence checks only. No network probe, provider request, secret readback,
  mutation, deploy, migration, or cleanup behavior.

Tests:

- Seven focused operations service/route contracts and two focused browser scenarios pass before
  the repository-wide gates.
- Full verification passes 1,892 tests at 100% statement/branch/function/line coverage, all 21 IMAP
  tests, and the complete 74-scenario mocked Chromium suite.

Notes:

- This card deliberately says configuration presence, not live readiness. F80 remote doctor remains
  authoritative for Cloudflare inventory and public smoke.
- Deployed as Worker version `25d931e2-b762-454d-bbff-80df63bfb005` with no pending migrations. The
  deployment inventory contained all nine expected runtime capabilities, public smoke passed 6/6,
  and remote doctor passed 25 checks with the documented live-Cron-inventory warning. An unsigned
  browser session was redirected from `/operations` to `/login`; authenticated 9/9 rendering remains
  covered by the production-shaped browser suite without requesting production credentials.

### 2026-08-12 — Record the evidence-source boundary

- Recovery capture/restore, signed-release verification, public smoke, and traced-mail-flow evidence
  are currently produced by operator scripts and retained outside D1/R2 state readable by the
  deployed Worker.
- The Operations Center must not manufacture a "latest successful" timestamp from source
  documentation or a local artifact. Those cards require a separately specified, authenticated,
  content-free evidence-ingestion and retention contract.
- Live Cron inventory remains delegated to the F80 provider doctor because Wrangler does not expose
  a trustworthy schedule read in the current workflow.

### 2026-08-12 — Specify content-free operational evidence history

Type: Feature / security boundary

Summary:

- Define an organization-scoped, recently-authenticated, fixed-shape evidence ledger for recovery,
  release, smoke, and mail-flow outcomes.
- Define append-only idempotency, conflict behavior, automatic bounded retention, partial read
  failure, aggregate status, and a read-only four-row Operations presentation.

Reason:

- Existing operator artifacts cannot truthfully appear in the deployed Operations Center until the
  Worker has an authorized persisted read model. Accepting arbitrary JSON or free text would turn
  that model into a new data-egress and secret-retention risk.

Impact:

- Specification first. No ingestion or persistence exists until failing contracts cover the
  authorization, tenant, privacy, time-window, idempotency, and migration boundaries above.

### 2026-08-12 — Implement content-free operational evidence history

Type: Feature / security boundary

Summary:

- Add migration `0032` with structurally content-free evidence rows, fixed database checks, exact
  organization/category/time uniqueness, organization indexes, timestamp normalization, and an
  atomic newest-200-per-organization retention trigger.
- Add an owner-only ingestion route backed by exact-session recent authentication, strict v1 input,
  90-day/future bounds, immutable idempotency, and race-safe conflict handling.
- Add an organization-scoped newest-per-category read model and a fixed four-row read-only
  Operations card with explicit missing, failed, passed, and unavailable states.
- Advance the signed-release schema policy from stale `0030` to exact `0032`, accounting for the
  already-deployed invitation lifecycle migration `0031`.

Security:

- Neither the table nor response has an arbitrary payload/free-text field. Actor and organization
  are retained for accountability but omitted from the overview. Every lookup, idempotency check,
  race resolution, and list query applies the authenticated organization boundary.
- Denied or stale owner sessions perform no evidence read. Concurrent conflicting replays cannot
  overwrite a winner, and the page adds no mutation controls.

Verification:

- Tests were written first and failed for the absent migration, service, and route.
- Focused migration/service/route/overview contracts and the two Operations browser scenarios pass.
- `npm run verify` passes 233 test files and 2,005 application tests at 100% statement, branch,
  function, and line coverage, plus all 21 IMAP bridge tests. Lint remains at the existing 36
  warnings with zero errors.
- `npm run e2e` passes all 86 Chromium scenarios, including passed/failed/missing operational
  evidence and partial-subsystem unavailability without rendering private fields or mutation
  controls.
- Commit `c00108c` deployed with migration `0032` as Worker version
  `53965c0f-6da0-44f1-8f79-c98ec3bc4944`. The production build contains both the read-only
  Operations page/API and `/api/admin/operations/evidence`; D1 has no pending migrations.
- Public smoke passes 6/6 and the remote doctor passes 25 checks with zero failures and only the
  documented live-Cron-inventory warning. The new ingestion route refuses an anonymous POST with
  `401` before body processing.
- A content-minimized remote D1 inspection confirms exactly the nine specified columns and one
  retention trigger. The table contains zero rows, proving deployment did not manufacture operator
  evidence or touch account/message content. Authenticated operator ingestion and script adapters
  remain later work.
