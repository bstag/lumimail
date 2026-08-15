# F82 — Read-only Operations Center

> Status: In Progress — content-free evidence-history slice deployed and boundary-verified
> Owner area: `src/lib/operations.ts`, `src/app/api/admin/operations/`, `src/app/(settings)/(org)/operations/`

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

### Fourth-slice trusted producer-adapter contract

- Evidence publication is an explicit operator choice. The existing smoke and signed-release
  verification commands retain their current behavior unless the dedicated recording mode/command
  is invoked; verification never writes evidence merely because a session token exists.
- The shared publisher accepts only an exact HTTPS origin with no credentials, path, query, or
  fragment. It takes the recently confirmed owner session token from the runtime-only
  `LUMIMAIL_SESSION_TOKEN` environment variable and sends it as a bearer credential. The token is
  never accepted as a command-line argument, persisted, or printed.
- The publisher sends only the strict `lumimail-operations-evidence-v1` request and accepts only the
  bounded success envelope returned by the ingestion route. Network, authorization, response, and
  caught errors collapse to `Operational evidence could not be recorded.` without echoing response
  bodies, request bodies, credentials, or private verification details.
- Public smoke derives `passedChecks`, `totalChecks`, and outcome from the complete fixed set of
  public HTTP checks, whose expected total is owned by the publisher's validation boundary.
  Recording mode can persist a real passing or failing smoke result, but cannot turn a failed check
  into a passing claim. If publication fails, the command exits non-zero; otherwise it preserves the
  underlying smoke result exit code.
- Signed-release recording first performs the existing pinned Ed25519 trust, identity, schema, and
  artifact verification. Only a successful verification publishes `release`, `passed`, `1/1`; a
  verification failure publishes nothing. A publication failure exits non-zero.
- `observedAt` is captured by the producer when its verification completes. Exact retries remain
  idempotent through the server contract. Neither adapter accepts a category, outcome, count, or
  timestamp from the command line.
- Recovery and mail-flow are deliberately not connected in this slice. Recovery is currently a
  sequence of separately successful capture, restore, application-isolation, rollback/return, and
  cleanup operations; mail-flow remains a controlled trace. A partial step or arbitrary operator
  count must not claim either end-to-end category passed.

### Fifth-slice received mail-flow proof contract

- Add a dedicated recently authenticated owner endpoint for mail-flow proof. It accepts only the
  fixed `lumimail-mail-flow-proof-v1` shape: the received message's RFC `Message-ID`, `In-Reply-To`,
  normalized `References`, and the producer observation timestamp. It never accepts category,
  outcome, passed/total counts, organization/user IDs, addresses, subject, body, provider response,
  job/message row IDs, or arbitrary fields.
- The operator command reads one locally supplied received `.eml` file. It refuses files over 10 MiB,
  header sections over 64 KiB, malformed/folded ambiguity, duplicate required fields, invalid RFC
  identifiers, and missing threading headers. It sends only the three required header values; no
  body, address, subject, received-routing header, attachment, filename, or local path crosses the
  network or appears in output.
- The received file supplies its outbound `Message-ID` and inbound `In-Reply-To`; no trace identifier
  is entered separately. The command takes the existing recent owner session from
  `LUMIMAIL_SESSION_TOKEN`, uses an exact HTTPS origin, and has the same bounded credential/error
  behavior as the smoke/release publisher.
- The producer timestamps the already-received artifact five seconds before its local command clock.
  This conservative offset tolerates ordinary sub-second workstation/edge skew while remaining a
  truthful lower bound on when the operator possessed the artifact; the server's strict no-future
  and 90-day bounds remain unchanged.
- After recent-session and organization equality are established, the server checks exactly eight
  fixed facts inside that organization: inbound persistence; matching reply persistence; shared
  thread/source linkage; stored `In-Reply-To`; stored `References`; immutable queue-snapshot headers;
  sent message/job state; and provider/RFC/delivered identifier equality with an attempted,
  error-free job. Missing or inconsistent facts derive a failed count; operators cannot override it.
- The server stores only the derived `mail_flow` outcome/count and timestamps through the existing
  append-only ledger. Request identifiers are used transiently for the scoped proof and are neither
  logged, stored in evidence, nor returned. A recent-auth denial happens before any trace read.
- A received `.eml` proves possession of a provider-delivered artifact, not independent provider
  attestation or DKIM verification. The proof therefore establishes Lumimail persistence/threading,
  queue/provider acceptance, and observed external arrival for that exact Message-ID without
  claiming universal delivery or inbox placement.
- A passing proof currently requires the outbound provider to return the same normalized RFC
  Message-ID that appears in the received artifact, which the Cloudflare Email Sending path does.
  Providers returning only opaque API identifiers fail closed until Lumimail persists a trustworthy
  mapping to the final RFC Message-ID; the producer does not infer one.

### Sixth-slice bounded operator failure contract

- Mail-flow recording may distinguish only fixed, actionable classes already defined by local
  validation or an exact HTTP status plus exact Lumimail error envelope: invalid/missing local
  artifact, invalid session, non-owner access, recent authentication required, invalid proof,
  immutable-history conflict, and generic service failure.
- The producer never prints raw response text/JSON, caught errors, RFC identifiers, file paths,
  addresses, subjects, message content, tokens, or provider/database details. Any unknown status,
  malformed envelope, changed message, transport exception, or unexpected value collapses to the
  existing generic `Mail-flow evidence could not be recorded.` message.
- Classification changes diagnostics only. It does not retry, reconfirm, modify proof data, weaken
  validation, or turn any failure into success.

### Seventh-slice recovery archive evidence contract

- The `recovery` category records exactly one derived claim: a named recovery archive is complete and
  intact at the moment the operator verified it. It does not claim that a restore rehearsal, Worker
  rollback, isolation check, or cleanup step passed. Those remain F79 operator evidence until they
  emit machine-readable reports, and the card's meaning is stated in those terms.
- Evidence is derived only from bytes. The producer re-runs the existing offline archive verification,
  which re-reads the manifest, re-hashes the D1 export, and re-hashes every referenced R2 object
  against its recorded size and SHA-256. No operator flag can supply a category, outcome, count, or
  timestamp, and no separate report file is trusted as an assertion.
- `totalChecks` is the number of artifacts actually verified: one D1 export plus each manifest object.
  `passedChecks` subtracts the distinct failing artifacts, so two problems reported for one file
  count once. A verified archive publishes `passed`; any problem publishes a truthful `failed` count
  and exits non-zero, because an incomplete backup is exactly what the card must surface.
- An unreadable, malformed, or foreign manifest publishes nothing. There is no artifact count to
  derive from, and inventing one would assert a backup that was never proven.
- An archive whose artifact count falls outside the ledger's accepted bounds publishes nothing rather
  than truncating or rescaling a count into range.
- The producer reuses the shared publisher: exact HTTPS origin, runtime-only `LUMIMAIL_SESSION_TOKEN`
  bearer credential, and strict `lumimail-operations-evidence-v1` body. Archive paths, object keys,
  hashes, and caught errors never reach output.

### Eighth-slice bounded publisher failure contract

- The shared publisher classifies its own failures, extending the sixth slice's mail-flow rule to
  every evidence producer. Local guards name an absent session token, a non-exact origin, and a
  result outside the accepted shape; each is detected before any request.
- Response classes require an exact status paired with the exact Lumimail error envelope: `401`
  invalid session, `403` non-owner, `403` recent authentication required, `400` invalid evidence,
  `409` immutable-history conflict, and `500` service failure. Any other status, unmapped server
  text, unexpected envelope, transport error, or caught exception collapses to the existing generic
  message, so server text never becomes an egress path.
- Smoke, signed-release, and recovery producers all print the classified message. An error that did
  not come from the publisher stays generic.
- All three producers stamp their observation five seconds behind the local command clock, using the
  same shared offset and rationale the mail-flow producer already applies. The ledger rejects any
  observation later than the edge clock, so a workstation running even fractionally ahead would have
  every result refused as invalid. The offset remains a truthful lower bound on when the producer
  observed the result.

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
| Unit `tests/unit/scripts/operations-evidence.test.ts` | strict publisher URL/body/response, bounded failures, bearer non-disclosure |
| Unit producer adapters | smoke-derived pass/fail counts, opt-in only, release verification-before-publish, publication failure exit |
| Unit mail-flow proof | bounded `.eml` header parser, tenant/recent-auth boundary, eight derived checks, identifier non-retention |
| Route mail-flow proof | strict body, content-free response/errors, bearer/cookie behavior, no work after owner denial |
| Route `tests/unit/app/api/admin/operations/route.test.ts` | owner guard, exact response, no reads after denial |
| Route `tests/unit/app/api/admin/operations/evidence/route.test.ts` | strict body, exact-session recent auth, 201/idempotent/409/error envelopes |
| Migration `tests/unit/db/operational-evidence-migration.test.ts` | content-free columns, unique/index/retention trigger, fresh and upgrade parity |
| E2E `tests/e2e/operations.spec.ts` | owner navigation/page, healthy and attention states, sanitized rendering |
| E2E restricted navigation | admin/member direct-route redirect and hidden owner-only link |
| Full | `npm run verify` and `npm run e2e` |

## 7. Scope Boundaries and Later Slices

The first two slices do not persist evidence. The third slice adds only a server-authorized,
content-free result ledger and read model; it does not upload or parse source artifacts. The fourth
slice binds public smoke and successful signed-release verification to that ledger without accepting
operator-authored results. The fifth slice adds a received-artifact-backed traced-mail-flow producer
with tenant-scoped server derivation. The seventh slice adds byte-derived recovery archive evidence.
Live Cron inventory is now proven by the F80 remote doctor rather than this page. Restore-rehearsal
attestation, independent delivery attestation, and additional integrity observations remain later
work. All other mutations remain separate, recently authenticated, confirmed, audited, and explicitly
specified.

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
- Decision: expose no general evidence CLI. Only named producers may construct evidence so an
  operator cannot use arbitrary flags to manufacture a passing category/count. — 2026-08-12
- Decision: use a runtime-only recently confirmed session bearer rather than a new API key or
  long-lived secret. Explicit recording therefore inherits the route's owner, tenant, expiry, and
  recent-authentication boundaries. — 2026-08-12
- Decision: verify mail-flow through an owner-scoped application endpoint rather than a direct
  operator D1 query. This avoids deployment-wide database credentials and binds the trace rows to
  the same organization that receives the evidence. — 2026-08-13
- Decision: require a received `.eml` artifact and match its RFC headers to persisted provider state.
  Provider acceptance alone is not external arrival; an operator checkbox is not derived proof. — 2026-08-13
- Decision: expose only an allowlist of exact status/envelope failure classes in operator output.
  This keeps failures actionable without making arbitrary server or provider text an egress path. — 2026-08-13
- Decision: scope the `recovery` category to archive completeness and integrity rather than to the
  full F79 rehearsal. Re-hashing every artifact is a byte-derived proof the producer can actually
  make; a restore rehearsal currently leaves no machine-readable report, and recording an operator
  claim would reintroduce exactly the derived-proof violation the fourth slice refused. — 2026-08-15
- Decision: derive `totalChecks` from the manifest's own artifact inventory instead of a fixed count.
  Recovery archives legitimately differ in object count between deployments and over time, and a
  fixed total would either reject real archives or misreport what was verified. — 2026-08-15
- Decision: publish a truthful failed recovery result rather than suppressing it. A backup that no
  longer verifies is the single most important thing the card can show an owner. — 2026-08-15

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

### 2026-08-12 — Connect trusted smoke and signed-release producers

Type: Feature / operator tooling

Summary:

- Add a non-CLI, fixed-shape evidence publisher with exact HTTPS-origin, runtime bearer, response,
  and content-free failure contracts.
- Make smoke import-safe and add explicit recording mode that derives the real fixed six-check
  outcome and counts while preserving the underlying smoke exit status.
- Add a separate signed-release recording command that publishes a fixed `release` pass only after
  the existing pinned cryptographic verification succeeds.

Security:

- No generic evidence command or flags for category, outcome, count, or observation time exist.
  Tokens are runtime-only and never printed; redirects and malformed/unexpected responses fail
  closed without returning server or caught-error content.
- Recovery and mail-flow remain unrecorded because their current sources do not yet prove one
  complete end-to-end result.

Verification:

- Producer and publisher tests were written first and failed because both modules were absent.
- All 35 focused publisher, producer, existing smoke, and existing signed-release contracts pass.
- `npm run verify` passes 235 test files and 2,033 application tests at 100% statement, branch,
  function, and line coverage, plus all 21 IMAP bridge tests. Lint retains the existing 36 warnings
  with zero errors after the new test fixtures add none.
- Browser E2E and Worker deployment are not rerun: this slice changes operator scripts and
  documentation only, while the already-deployed ingestion API/UI contract is unchanged.

### 2026-08-13 — Derive mail-flow evidence from a received artifact

Type: Feature / privacy boundary

Summary:

- Add a bounded local `.eml` header producer that extracts only one canonical received
  `Message-ID`, `In-Reply-To`, and `References` chain.
- Add a dedicated recently authenticated owner route and tenant-scoped service that derive eight
  fixed persistence, threading, immutable snapshot, sent-state, provider, and received-identity
  checks without accepting an operator outcome or count.
- Store only the derived `mail_flow` result through the existing content-free append-only ledger.

Security:

- Owner/recent-session and organization equality are established before trace reads. Every message
  and job query applies that organization, and invalid proof is rejected before D1.
- The `.eml` body, addresses, subject, routing headers, filename, path, database row IDs, queue
  payload content, and RFC identifiers are never stored in evidence, logged, printed, or returned.
  Only the three required identifiers cross the proof request transiently.
- Opaque provider identifiers fail closed because external arrival cannot be inferred without an
  exact persisted mapping to the received RFC Message-ID.

Verification:

- Proof parser/service/route tests were written first and failed because all three components were
  absent. Twenty-nine focused contracts now pass, including tenant denial-before-read, malformed and
  oversized artifact rejection, derived failure, exact response validation, redirects, and
  credential/provider-detail non-disclosure.
- `npm run verify` passes 238 test files and 2,062 application tests at 100% statement, branch,
  function, and line coverage, plus all 21 IMAP bridge tests. Lint retains the existing 36 warnings
  with zero errors.
- `npm run e2e` passes all 86 Chromium scenarios, including the existing sanitized Operations
  rendering for present/missing/failed evidence.
- Commit `cb610b7` deployed with no pending migrations as Worker version
  `2d65dfbc-bbe9-41a4-ae02-92180c699645`. The production build includes
  `/api/admin/operations/evidence/mail-flow`; an anonymous POST receives the bounded `401` envelope
  before proof parsing or trace access.
- Production public smoke passes 6/6. The corrected direct remote doctor invocation passes 25
  checks with zero failures and retains only the documented live-Cron-inventory warning.
- Authenticated recording is intentionally not manufactured during deployment. It requires the
  owner's fresh exact session and private received `.eml` artifact.
- Authenticated production proof completed on 2026-08-13: the received artifact passed all eight
  derived persistence, threading, immutable queue-header, sent-state, provider-ID, and exact-arrival
  checks and recorded `mail_flow` passed `8/8`. The first strict attempt exposed approximately
  0.5-second workstation/edge clock skew; a five-second conservative observation offset passed
  without weakening the server validator or modifying trace data.

### 2026-08-13 — Tolerate producer clock skew

Type: Bug fix / operator reliability

Summary:

- Backdate the received-artifact observation by five seconds in the local producer so a workstation
  slightly ahead of the edge does not submit a future timestamp.
- Keep the API and ledger's strict future/stale validation unchanged.

Reason:

- A valid production artifact and fresh owner session received `400 Invalid mail-flow proof`; the
  production HTTP clock was approximately 0.5 seconds behind the workstation. Repeating the exact
  proof with a five-second offset recorded a server-derived pass `8/8`.

Tests:

- Add an exact producer regression asserting the conservative timestamp; it failed first against the
  unadjusted command and passes after the offset.
- `npm run verify` remains green across 238 test files and 2,062 application tests at 100% statement,
  branch, function, and line coverage, plus all 21 IMAP bridge tests. Lint retains the existing 36
  warnings with zero errors.
- No Worker redeploy is required: the strict production route already accepted and recorded the
  correctly offset proof, and this fix changes only the local operator producer and documentation.

### 2026-08-13 — Specify bounded mail-flow diagnostics

Type: Operator UX / privacy hardening

Summary:

- Define fixed safe messages for local artifact, session, owner, recent-auth, proof-validation,
  conflict, and generic service failures.
- Require unknown or malformed failures to remain generic without echoing response or caught-error
  content.

Impact:

- The producer now reports actionable fixed diagnostics for exact known failures while preserving the
  generic privacy boundary for unknown, malformed, or transport failures.
- No server behavior, authorization boundary, proof data, retry behavior, or deployment changes.

Tests:

- Red-first focused run failed in the six expected local/server classification cases before the
  implementation.
- Focused producer suite passes: 23/23.
- `npm run verify` passes: typecheck, lint with 36 existing warnings and zero errors, 238 test files
  with 2,069 application tests at 100% coverage, and 21 IMAP bridge tests.
- `npm run e2e` is not required because this changes only local operator CLI diagnostics and no
  browser-visible behavior.

### 2026-08-15 — Record byte-derived recovery archive evidence

Type: Feature + Bug

Summary:

- Add `npm run recovery:record`, a named producer that re-runs the existing offline archive
  verification and publishes the derived `recovery` result through the shared evidence publisher.
- Derive `totalChecks` from the manifest inventory (one D1 export plus each object) and subtract
  distinct failing artifacts, so two problems reported for one file count once.
- Extend the publisher's validation boundary to accept `recovery` with a derived total, keep
  `mail_flow` refused on that route because it has its own server-derived endpoint, and add the
  ledger's upper artifact bound.
- Fix the publisher's smoke rule, which still required exactly six checks after F88 extended the
  public contract to eight and therefore rejected every real `npm run smoke:record` result. The
  expected total is now one boundary-owned constant shared with the F80 doctor.

Reason:

- The Recovery card has rendered `Not recorded` since the first slice because no producer could make
  a derived claim. Archive verification is a real byte-derived proof that the producer can make
  today, unlike the rehearsal steps that leave no machine-readable report.

Impact:

- No schema, route, authorization, or UI change. The `recovery` category and its card already
  existed; only the producer was missing. Recording still requires a recently authenticated owner
  session and remains an explicit operator action.

Tests:

- Focused producer contracts cover the passing derivation, per-artifact failure counting, the clamp
  that keeps a derived failure below the verified total, four publish-nothing classes, four
  argument refusals, and bounded publication failure.
- Publisher contracts add an accepted recovery result, a refused `mail_flow` category, out-of-bound
  and zero totals, and a refused stale six-check smoke total.
- `npm run verify` passes: typecheck, lint with 0 errors and 43 pre-existing warnings, 275 test
  files with 2,381 application tests at 100% statement/branch/function/line coverage, and 21 IMAP
  bridge tests.
- `npm run e2e` is not required: this adds an operator CLI and changes no browser-visible behavior.

Notes:

- The card cannot show a real value until an operator runs the command against a verified archive
  with a fresh owner session. Restore-rehearsal attestation remains later work.

### 2026-08-15 — Classify publication failures and stamp observations behind the local clock

Type: Bug

Summary:

- Extend the shared operational-evidence publisher with the bounded failure classes the sixth slice
  already defined for mail-flow: three local classes checked before any request, and six response
  classes keyed on an exact status plus the exact Lumimail error envelope.
- Print the classified message from the smoke, signed-release, and recovery producers. Anything the
  publisher did not classify stays generic.
- Stamp every producer's observation five seconds behind its local clock through one shared helper,
  matching the offset the mail-flow producer already applied.

Reason:

- The first real `npm run recovery:record` run verified its archive and then failed publication with
  only `Operational evidence could not be recorded.` The operator could not tell an absent session
  token from a non-owner session, a stale recent-auth window, or a history conflict — the same
  unactionable-gate problem the F80 Cron check hit, and already solved once for mail-flow.
- The classified retry then exposed the second defect: the server refused the result as invalid
  because the producer stamped its observation at the local clock, which the edge saw as the future.
  The smoke, signed-release, and recovery producers had never inherited the mail-flow offset and
  would all have failed the same way on any workstation running ahead of the edge.

Impact:

- No server, schema, authorization, or privacy-boundary change. Unmapped statuses, unmapped server
  text, unexpected envelopes, and transport errors still collapse to the generic message.

Tests:

- Publisher contracts cover all six response classes, four cases that must stay generic, and three
  local classes proven to reject before any request.
- Producer contracts assert all three producers surface a classified message, keep an unclassified
  failure generic without leaking the token, and publish an observation exactly the shared offset
  behind the local clock.
- `npm run verify` passes: typecheck, lint with 0 errors and 43 pre-existing warnings, 275 test
  files with 2,403 application tests at 100% statement/branch/function/line coverage, and 21 IMAP
  bridge tests.
