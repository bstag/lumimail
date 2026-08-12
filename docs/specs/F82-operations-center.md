# F82 — Read-only Operations Center

> Status: In Progress — runtime-readiness slice implemented; production rollout next
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

## 6. Test Plan

| Layer | Coverage |
|-------|----------|
| Unit `tests/unit/lib/operations.test.ts` | aggregation, timestamps, degraded sections, no sample/error leakage, immutable report |
| Route `tests/unit/app/api/admin/operations/route.test.ts` | owner guard, exact response, no reads after denial |
| E2E `tests/e2e/operations.spec.ts` | owner navigation/page, healthy and attention states, sanitized rendering |
| E2E restricted navigation | admin/member direct-route redirect and hidden owner-only link |
| Full | `npm run verify` and `npm run e2e` |

## 7. Scope Boundaries and Later Slices

This slice does not persist new evidence. Later F82 work may add sanitized binding/provider readiness,
backup/restore rehearsal evidence, release/signature status, smoke/mail-flow evidence, cron state, and
integrity observations after each has a server-authorized read model. All mutations remain separate,
recently authenticated, confirmed, audited, and explicitly specified.

## 8. Decisions

- Decision: reuse existing health/retention services; do not duplicate provider logic. — 2026-08-12
- Decision: omit retention object-key samples even though the detailed API currently exposes them to
  owners. Aggregate health does not require private storage topology. — 2026-08-12
- Decision: partial read failure returns a successful sanitized overview with an unavailable section
  instead of turning other safe evidence into a page-wide error. — 2026-08-12
- Decision: first slice is owner-only because queue and platform storage health are deployment-wide,
  not organization-admin data. — 2026-08-12

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

- Current F81 schema compatibility is exact (`0028`), so this slice presents its maximum as the
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

Notes:

- This card deliberately says configuration presence, not live readiness. F80 remote doctor remains
  authoritative for Cloudflare inventory and public smoke.
