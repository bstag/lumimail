# Lumimail deployment remediation plan

This is the living checklist for closing the deployment, contract, permissions, email-flow, and user-interface gaps discovered while deploying Lumimail to Cloudflare. Update this document as each item moves through the engineering lifecycle.

## How to use this plan

For every remediation item:

1. Find or create its `docs/specs/F<NN>-<slug>.md` specification.
2. Record current behavior, desired behavior, decisions, edge cases, error states, and a test plan.
3. Write a failing regression test before changing implementation.
4. Implement the smallest correct change.
5. Run `npm run verify`; also run `npm run e2e` for user-visible behavior.
6. Update the feature specification and `docs/MVP_SCOPE.md` when scope changes.
7. Add dated verification evidence below and check the item off only when all acceptance criteria pass.

Status meanings:

- `[ ]` Not started or not yet verified.
- `[~]` In progress; not safe to treat as complete.
- `[x]` Implemented and verified with the evidence recorded in this document.
- `[!]` Blocked; the reason and required decision must be recorded.

## Priorities and dependencies

Work from top to bottom unless a newly discovered security or data-loss issue takes precedence.

### Priority override — security

- [x] **R-19 Restore Workers-safe inbound HTML sanitization.** Spec: [F34](./specs/F34-workers-html-sanitization.md).
  - The current Workers fallback must not return untrusted HTML unchanged.
  - Define safe handling for active elements, event attributes, dangerous URLs, remote resources, forms, embedded content, and malformed markup.
  - Acceptance: adversarial sanitizer tests run in the Workers-compatible test environment and prove that stored email cannot execute active content when viewed.
  - Acceptance: the message viewer applies defense in depth without breaking safe plain text and permitted formatting.
  - Evidence 2026-07-22: regression reproduced; 16 focused tests pass; `npm run verify` passes with 881 tests and 100% configured coverage; all 12 browser tests, OpenNext build, and Wrangler dry run pass.
  - Evidence 2026-07-22: deployed Worker `722ae8e3-bb50-4031-9b96-dfc590a20739` with 105 ms startup; manifest and login HTTP smoke checks returned 200.
  - Evidence 2026-07-22: first controlled production message arrived successfully and did not load its remote image. It was a reply with quoted content, so the current display logic selected the plain-text alternative; this did not exercise the final HTML-render path.
  - Evidence 2026-07-22: a new non-reply production HTML message retained bold formatting and a safe HTTP link in the message view. Together with the remote-image result, the production acceptance path passed.

### Phase 0 — Completed deployment repairs

- [x] **R-00 Upgrade production dependencies.** Spec: [F36](./specs/F36-production-dependency-upgrade.md). Verified with `npm run verify`, OpenNext build, and Wrangler dry run.
- [x] **R-01 Normalize the registration domain response.** Spec: [F37](./specs/F37-registration-domain-response.md). Regression tests and full verification passed; corrected Worker deployed.
- [x] **R-02 Reconcile organization and alias schema.** Spec: [F38](./specs/F38-production-schema-reconciliation.md). Migration `0007` verified locally and applied to production; first user registration subsequently succeeded.

### Phase 1 — Data integrity and API contracts

- [x] **R-03 Create the missing password-reset-token migration.** Spec: [F39](./specs/F39-password-reset-schema-reconciliation.md).
  - Acceptance: applying all SQL migrations to a fresh D1 database creates `password_reset_tokens` with the columns, constraints, and indexes expected by Drizzle.
  - Acceptance: an existing production database can advance without destructive rebuilding.
  - Acceptance: forgot-password and reset-password regression tests exercise the real migrated schema.
  - Acceptance: local schema comparison and `npm run verify` pass before production application.

- [x] **R-04 Establish one API response contract and parser.** Spec: [F40](./specs/F40-api-response-contract.md).
  - Document which endpoints use `{ success, data }` and `{ success, error }` envelopes.
  - Avoid an unrelated all-at-once backend rewrite; provide a typed client-side parser or migrate endpoints in explicitly tested groups.
  - Acceptance: malformed, unsuccessful, and successful responses are handled without unsafe casts.

- [x] **R-05 Repair known API/client contract mismatches.** Depends on R-04. Spec: [F41](./specs/F41-api-client-contract-repairs.md).
  - Onboarding domain and mailbox creation.
  - Admin domain creation errors and domain DNS details.
  - Filter-page label loading.
  - Compose send result and post-send attachment upload.
  - Creation forms that currently read nested API errors as top-level strings.
  - Acceptance: unit contract tests cover every corrected client; user-visible flows receive E2E coverage.

- [x] **R-06 Add automated migration/schema drift detection.** Depends on R-03. Spec: [F42](./specs/F42-schema-drift-detection.md).
  - Apply the executable SQL migrations to an empty local D1 database in CI/test setup.
  - Compare the resulting tables, columns, indexes, and foreign keys with the expected Drizzle schema.
  - Acceptance: removing a required executable migration statement makes the check fail even when Drizzle snapshots remain valid.
  - Evidence 2026-07-22: seven focused tests pass; Wrangler applied migrations `0000`–`0008` to isolated empty local D1 state; the resulting tables, columns, indexes, and foreign keys match the live Drizzle schema; mutation regressions detect missing structures without reading snapshots; `npm run verify` passes with 887 tests and 100% configured coverage.

- [x] **R-21 Complete production password recovery.** Depends on R-03 and R-04. Spec: [F43](./specs/F43-password-recovery.md).
  - Add the missing forgot-password and reset-password pages with non-enumerating responses and safe expired/used-token handling.
  - Deliver reset links through the configured mail provider in production; never return or log a reset token.
  - Acceptance: unit and E2E tests cover known and unknown accounts, expiration, reuse, successful reset, and subsequent login.
  - Evidence 2026-07-22: 28 focused tests, 904-test full verification at 100% configured coverage, all 16 browser tests, Cloudflare sending-domain check, OpenNext build, and Wrangler dry run pass. Worker `e63887e2-a872-4fe9-8eb2-8d2282a05fef` deployed; recovery pages return HTTP 200 and invalid API input returns 400.
  - Evidence 2026-07-22: controlled production recovery passed email receipt, reset-link handling, password change, and subsequent login. No recovery address, token, link, or password was recorded.

- [x] **R-28 Add API-key revocation and lifecycle controls.** Spec: [F44](./specs/F44-api-key-lifecycle.md).
  - Add user-scoped revoke/delete behavior, make the one-time secret display unambiguous, and define audit visibility for last use.
  - Acceptance: a revoked key immediately fails authentication and cannot read or send through any API-key endpoint.
  - Evidence 2026-07-22: 30 focused lifecycle tests, fresh-migration structural coverage, 919-test full verification at 100% configured coverage, two Chromium lifecycle scenarios, OpenNext build, Wrangler dry run, production migration `0009`, remote schema inspection, Worker `158f8558-5c94-4849-aceb-730e7e56fae5`, page HTTP 200, unauthenticated revoke HTTP 401, and controlled production UI revocation-state validation.

- [x] **R-33 Verify upgraded databases, not only fresh ones.** Extends R-06. Spec: [F42](./specs/F42-schema-drift-detection.md).
  - `tests/unit/db/migrations.test.ts` only applies migrations to an empty database, and F42 currently scopes upgrade paths out. A migration that succeeds only against a fresh database passes verification today while breaking a real deployment.
  - Apply an earlier migration prefix to isolated local D1 state, then apply the remaining migrations to that same state and compare the result with the live Drizzle schema.
  - Acceptance: the staged-upgrade contract matches the fresh contract exactly, and a migration made fresh-only fails the upgrade check while the fresh check still passes.
  - Evidence 2026-07-24: F42 now generates a per-stage Wrangler project sharing one `--persist-to` directory, because Wrangler resolves `migrations_dir` from its configuration file and offers no flag to apply migrations up to a chosen version. Applying `0000`–`0013` and then the full set to that same state reaches exact Drizzle parity, confirming the current migration set is upgrade-safe. The fresh-only regression edits an already-applied migration and was observed passing the fresh contract while failing the upgraded contract with `Missing column: mailboxes.upgrade_probe`, which is the intended asymmetry. `npm run verify` passes with 1,287 application tests across 149 files at 100% configured coverage plus all 16 bridge tests. No deployment was required because this is verification tooling with no runtime or user-visible behavior.

### Phase 2 — Sending and routing correctness

- [x] **R-07 Make apex-domain sending provisioning truthful and usable.** Spec: [F45](./specs/F45-cloudflare-sending-domain-readiness.md).
  - Determine the supported Cloudflare Email Sending configuration for an apex zone such as `lucidkith.com`.
  - Never report a domain as sending-enabled unless provisioning and verification succeeded.
  - Surface actionable DNS/provider status in the interface.
  - Acceptance: send a traced test message from the configured domain and record provider/DNS verification evidence without storing message content in this document.
  - Evidence 2026-07-22: 88 focused contracts, 936-test full verification at 100% configured coverage, three relevant Chromium scenarios, current Wrangler/API contract inspection, exact enabled provider/DNS status for both target apex domains, OpenNext build, Wrangler dry run, Worker `d82e393c-1abb-4f68-9719-284eb31c73af`, production D1 reconciliation, HTTP 200/401 smoke checks, and the user's prior controlled outbound-send confirmation.

- [x] **R-08 Make catch-all syntax unambiguous.** Spec: [F46](./specs/F46-domain-catch-all-routing.md).
  - Define whether the canonical catch-all is `*`, `*@domain`, or both.
  - Normalize accepted input or reject unsupported patterns.
  - Test exact address, local-part, catch-all, precedence, and no-match behavior across multiple domains.
  - Evidence 2026-07-22: implementation and provider-safety contracts pass in 985-test `npm run verify` at 100% configured coverage; both catch-all Chromium scenarios passed before the known Playwright server-teardown hang; OpenNext build and Wrangler dry run pass; Worker `3a99cabe-fbf6-4d1d-b5cb-5df76458b6c2` deployed with 49 ms startup; routing page returned HTTP 200 and unauthenticated POST returned 401.
  - Production evidence 2026-07-22: after explicit operator approval, the LucidKith catch-all was moved from external forwarding to the `lumimail` Worker and a canonical internal `*`/`store` rule targeting its admin mailbox. Henriksen was then migrated from Migadu MX records to Cloudflare Email Routing, added to Lumimail, and configured with the same canonical catch-all shape. Provider and D1 reads confirmed one Worker-backed catch-all per domain. Controlled exact-address and deliberately nonexistent-recipient messages arrived in the intended admin mailbox on both domains without recording message content.

- [ ] **R-09 Implement actual external forwarding or remove the claim.** Spec: [F62](./specs/F62-external-forwarding.md).
  - Current forwarding behavior only records/logs the action.
  - Specify loop prevention, sender rewriting, authentication/deliverability behavior, failure handling, and audit visibility before implementation.
  - Acceptance: a controlled external recipient receives the forwarded message and failures are observable and retry-safe.
  - Severity correction 2026-07-24: this is not only an unimplemented feature. Forward rules are creatable through the UI and API today and the matching mail is silently discarded, so R-09 covers an active mail-loss defect.
  - Direction 2026-07-24: implement forwarding natively via Cloudflare Email Routing so Lumimail never implements sender rewriting or DKIM re-signing.
  - Design finding 2026-07-24: forwarding cannot work in the current inbound architecture even in principle. `worker.ts` `email()` stores to R2 and enqueues, and the routing decision happens later in `processInboundMessage`, by which time the `ForwardableEmailMessage` capable of forwarding no longer exists. F62 therefore moves the forward decision into the `email()` handler and uses `message.forward()` rather than provisioning provider-level forward rules, which preserves the canonical F46/F60 one-Worker-rule shape and keeps store-and-forward and group fan-out reachable.
  - Security finding 2026-07-24: Cloudflare destination addresses are account-level and shared across all Lumimail tenants, so verification status alone must never authorize a forward. F62 adds an organization-scoped ownership table required in addition to Cloudflare verification.
  - Local evidence 2026-07-24: [F62](./specs/F62-external-forwarding.md) is implemented. Migration `0018` adds organization-scoped `forwarding_destinations`; the Worker's `email()` handler resolves routing and calls `message.forward()` for authorized destinations; forward decisions carry their owning organization; rule creation and update refuse unowned, unverified, and managed-domain destinations with 422; the `console.info` stand-in is removed; and `/routing` offers only verified destinations. An undeliverable forward with no storing mailbox rejects at SMTP so the sender retries, and a routing or forwarding fault falls through to the ordinary store path so inbound cannot become worse than before. `npm run verify` passes with 1,352 tests across 156 files at 100% configured coverage; both Chromium forwarding scenarios pass; migration `0018` reaches parity on fresh and upgraded databases. Three pre-existing tests encoded the old silently-dropping behavior and were updated to the fail-closed contract.
  - Production evidence 2026-07-25: migration `0018` is applied to `lumimail-prod` with none pending, and version `0336c6ab-af1b-499c-85d7-7087cc76c33a` is live at 100%. `GET /` and `/routing` returned 200, and unauthenticated `GET /api/forwarding-destinations` returned 401.
  - Production fail-closed evidence 2026-07-25: with no verified destinations, selecting **Forward to address** on `/routing` renders no destination selector and states that a destination must be added and verified first. Three refusals were exercised live and each returned its specific reason without persisting anything: a destination on a Lumimail-managed domain returned 422 `Cannot forward to an address on a domain Lumimail manages`; a malformed address returned 400; and a forward rule naming an unregistered destination returned 422 `Register this forwarding destination before using it`. A named pattern was used so no catch-all provisioning was triggered. Re-reading `/api/routing-rules` and `/api/forwarding-destinations` afterwards showed zero forward rules and zero destinations, with only the two pre-existing `*/store` catch-alls intact. This is the exact defect R-09 exists to fix: the rule that previously would have been created and then silently discarded mail is now refused at creation.
  - Remaining: verification of a real destination address by its recipient, and one controlled forwarded message received at an external mailbox. R-09 stays unchecked until a forwarded message has actually been received, because nothing has yet exercised `message.forward()` against a live destination — only the paths that refuse to forward have been proven.

- [x] **R-10 Connect outbound sending to the configured queue.**
  - Define synchronous acknowledgement, retry policy, idempotency, dead-letter handling, and user-visible delivery states.
  - Acceptance: HTTP requests enqueue rather than perform provider delivery inline, and duplicate queue delivery cannot send duplicate mail.
  - Evidence 2026-07-24: F54 implements HTTP 202 queue acknowledgement, job-ID-only queue payloads, conditional D1 at-most-once claims, provider-specific transient/permanent classification, bounded retry delay, fail-closed ambiguous outcomes, dedicated DLQ finalization, and visible queued/sent/failed states. `npm run verify` passes with 1,153 application tests at 100% coverage plus 16 bridge tests; all 35 Chromium scenarios passed before the known Wrangler teardown timeout; the final OpenNext build and Wrangler dry run pass. Migration `0012` applied to `lumimail-prod`; the outbound DLQ and all three consumers are active. A controlled production composer send completed through Worker `73a3d71a-411b-4de7-8ada-0e1decdf39e1` with message/job state `sent`, one attempt, a provider message ID, and no error. Duplicate delivery, classified retry, ambiguous-result, and DLQ paths are covered by deterministic tests; live queue injection was not added solely for validation because Wrangler 4.113 exposes no message-push command.

- [ ] **R-11 Prevent orphaned raw inbound objects.** Spec: [F63](./specs/F63-r2-retention-and-cleanup.md).
  - Define retention for unroutable, rejected, failed, and successfully processed messages.
  - Acceptance: every R2 object reaches an intentional retained or deleted state, with retry-safe cleanup and tests.
  - Scope finding 2026-07-25: the orphan set was larger than "raw inbound". `message_bodies.raw_r2_key` is write-only — nothing reads raw MIME back — and `attachments.message_id` cascades on message delete, so deleting a draft or a mailbox removed the metadata rows while leaving the R2 objects. F62 enlarged the raw class again, because forward-only addresses store nothing.
  - Retention policy decided 2026-07-25: raw is deleted once processing succeeds; unstored raw (unroutable, rejected, forward-only) is kept 7 days for diagnosis then swept; attachments are retained while referenced and swept once unreferenced and older than 7 days; the pre-existing backlog is reported before anything is deleted.
  - Local evidence 2026-07-25: F63 deletes raw after successful processing and clears its reference first; `src/lib/r2-retention.ts` selects only objects unreferenced in D1 *and* older than the retention age, pages through R2 cursors, and restricts itself to the `inbound/` and `attachments/` prefixes. The age bound is what makes the unreferenced check safe against in-flight writes. Owner-only `/api/admin/r2-retention` reports as a dry run and deletes only on an exact `confirm` value. The scheduled sweep is gated by `R2_SWEEP_ENABLED` and ships disabled so the backlog is not removed before review. `npm run verify` passes with 1,377 tests across 158 files at 100% configured coverage plus all 16 bridge tests.
  - Production evidence 2026-07-25: version `ace31e0c-69b6-4cfa-9c06-d1dd8fb70453` is live at 55 ms startup with no migration required; `GET /` returned 200 and both methods on `/api/admin/r2-retention` returned 401 unauthenticated. Raw deletion after successful processing is active. `R2_SWEEP_ENABLED` is unset, so the scheduled sweep is deployed but inert by design.
  - Backlog evidence 2026-07-25: the owner-only report returned `scanned: 15, orphans: 0, bytes: 0`. There was no accumulated backlog to approve or delete, because this deployment has not handled enough mail to build one. The guarded delete was therefore never exercised against production data.
  - Sweep enabled 2026-07-25: with a measured zero backlog there was no unreviewed data the sweep could remove, so `R2_SWEEP_ENABLED` was set to `true`. The sweep runs hourly rather than on every one-minute tick.
  - Caveat: an object must be unreferenced *and* older than 7 days to be reported, so a zero reading proves nothing is currently eligible, not that nothing will become eligible. Unroutable or forward-only mail received in the preceding week is age-protected and would surface later. Re-read the report after a week of normal operation before treating retention as demonstrated.
  - Production evidence 2026-07-25: version `1267f4d1-4091-4631-9624-956d3686b1fd` is live with `R2_SWEEP_ENABLED ("true")` confirmed among the deployed bindings. The post-deploy report is unchanged at `scanned: 15, orphans: 0`, so the newly enabled sweep correctly deleted nothing.
  - Remaining before R-11 can be checked: an actual production sweep must delete at least one genuinely orphaned object. The mechanism is deployed and enforced, but the deletion path has never run against real data, so "every R2 object reaches an intentional retained or deleted state" is currently true only because nothing has yet become eligible. Re-read the report after a week; if orphans appear and the hourly sweep clears them, R-11 closes.

- [x] **R-20 Include attachments in outbound message delivery.**
  - Define the outbound transaction so validated attachments are available before provider delivery and are encoded into the provider request/MIME message.
  - Specify size/type limits, partial-failure behavior, cleanup, API-key send behavior, reply/forward behavior, and retry/idempotency interaction with R-10.
  - Acceptance: a controlled recipient receives the attachment with the expected filename, content type, and bytes; a failed send cannot leave a misleading sent message.
  - Evidence 2026-07-24: F55 replaces browser post-send upload with one multipart acceptance request and adds Base64 API-key attachments; enforces provider-portable count/size/type/filename limits; writes exact bytes to opaque R2 keys before the D1 message/body/job/attachment batch; compensates partial R2/D1 failures; snapshots metadata only; requires canonical tenant/message keys and exact bytes in the queue consumer; retries transient R2 reads; and passes binary attachments to Cloudflare or Base64 attachments to Resend. The legacy upload endpoint is draft-only. `npm run verify` passes with 1,194 application tests at 100% coverage plus all 16 bridge tests; all 36 Chromium scenarios passed before the known Wrangler teardown timeout; the OpenNext build and Wrangler dry run pass. Worker `9761795a-0f91-49cc-91bc-494be8daa441` delivered a controlled 134-byte `text/plain` attachment in one provider attempt; production R2 matched source SHA-256 `ECCB95071583A3912D3440957556A5C141DCD0EEEE083F7798F2FD35ADC272D4`, the Sent UI showed the expected metadata, and the operator confirmed external receipt and display. The outbound queue was found administratively paused during validation and resumed without resubmitting the message; pause/backlog monitoring remains operational follow-up.

- [x] **R-24 Ingest inbound MIME attachments.** Coordinates with R-20. Spec: [F57](./specs/F57-inbound-attachment-ingestion.md).
  - Parse attachment parts, store their bytes in R2, create metadata rows, and define cleanup when any step fails.
  - Acceptance: controlled inbound image, PDF, and binary fixtures can be listed and downloaded with exact bytes and safe content headers.
  - Evidence 2026-07-24: F57 parses PostalMime attachment bytes and metadata, enforces a 50-part/25-MiB all-or-nothing ingestion policy, writes independent mailbox-owned R2 objects before one D1 message/body/metadata batch, compensates R2/D1 failures, exposes truthful omission status, and restricts inline rendering to JPEG/PNG/GIF/WebP/PDF with CSP and `nosniff`. `npm run verify` passes with 1,222 application tests at 100% coverage plus all 16 bridge tests; both F57 Chromium scenarios pass. The full 40-scenario suite passed 37 initially; one unrelated navigation failure passed serially, while two F51 navigation tests remain blocked by the existing Next-dev Cloudflare-context harness (`ERR_ABORTED` redirect and `getCloudflareContext` initialization), not an F57 path. The production Next/OpenNext builds and Wrangler dry run pass. Migration `0014` is applied and Worker `fed65823-9355-44ba-889d-a0f6b28aec59` is live; the attachment API returns unauthenticated HTTP 401 and Wrangler reports no pending migrations. Controlled message `msg_CFVdyWb9uieTffTFtcbe6` stored three independent attachment rows/keys with status `stored` and no error: a 90-byte text file, 56,400-byte PDF, and 68,249-byte JPEG. Production UI inspection confirmed all three rows, the PDF iframe resource, and a fully loaded 824×1464 JPEG; the operator downloaded the text attachment and confirmed its contents were unchanged.

- [x] **R-25 Implement RFC-aware conversation grouping.** Specs: [F58](./specs/F58-rfc-aware-conversation-grouping.md), [F59](./specs/F59-html-preserving-replies.md).
  - Parse Message-ID, In-Reply-To, and References; define stable thread assignment for inbound and outbound messages.
  - Define how the newest sanitized HTML reply is displayed when a plain-text alternative contains quoted-history markers; the current UI discards HTML whenever quoted text is detected.
  - Acceptance: a traced multi-message reply chain renders as one thread without merging unrelated messages.
  - Evidence 2026-07-24: F58 adds bounded Message-ID/In-Reply-To/References parsing, mailbox-scoped opaque thread resolution, same-mailbox reply authorization, reply-aware autosaved drafts, durable Queue headers, Cloudflare/Resend header mapping, and HTML-first duplicate-quote suppression. Migration `0015` is applied. An initial controlled chain grouped correctly but exposed flattened quoted HTML; F59 repairs that path with server-derived multipart bodies, defense-in-depth source HTML sanitization, and authored-only reply compose. `npm run verify` passes with 1,257 application tests at 100% coverage plus all 16 bridge tests; the focused Chromium contract, OpenNext build, and Wrangler dry run pass. Commit `7deecf3` is deployed as Worker `540fc496-94c5-46f0-b36f-e644ddf2390b`. Fresh controlled thread `msg_s-nv0Beq22gB4SPkU5lLh` groups the inbound original, Lumimail reply, and external follow-up; DOM inspection confirms bold/italic source markup survives both Lumimail's blockquote and the external client's nested quotation. Inline color is intentionally outside the current sanitizer contract and is deferred to a future rich-text feature.

- [ ] **R-26 Complete alias and group provisioning.** Coordinates with R-08 and R-09.
  - Provision Cloudflare delivery for alias addresses and add organization-admin UI/API behavior for group membership.
  - Acceptance: internal aliases and multi-member groups created entirely through Lumimail receive a controlled inbound message without manual Cloudflare rule creation.
  - Evidence 2026-07-24: [F60](./specs/F60-internal-alias-and-group-provisioning.md) adds exact Worker-rule ownership/reuse, provider-first creation with D1 compensation, owned-rule-only deletion, strict mailbox/group contracts, explicit 2–50 mailbox membership, same-organization cross-domain targets, group management UI/API, migration `0016`, and bounded group resolution without per-member mailbox queries. The false external-forwarding creation claim is removed; R-09 remains open. `npm run verify` passes with 1,285 application tests at 100% coverage plus all 16 bridge tests; executable migration parity, the focused Chromium group contract, OpenNext build, and Wrangler dry run pass. The full browser suite passes 39/42, with only the three pre-existing redirect/menu harness failures; F60 passes in both runs. Migration `0016` is applied to production with no migrations pending; live schema inspection confirms the owned-rule and explicit-member columns and indexes. Commit `33cb643` is deployed as Worker `58a71573-c187-475e-bf8c-80a8d512eceb`; production returned HTTP 200 for `/` and HTTP 401 at the unauthenticated auth boundary. Provider exact-rule inspection and controlled simple/group delivery remain before checking R-26.

- [ ] **R-34 Make terminally failed outbound delivery recoverable.** Depends on R-10.
  - `processOutboundDeadLetter` marks a job `failed` and nothing else; there is no requeue, resend, or operator recovery path in `src/`. A message that exhausts retries or lands in the dead-letter queue is permanently stuck even when the underlying cause is fixed.
  - Define who may recover a failed job, how recovery interacts with the existing conditional at-most-once claim so recovery cannot duplicate mail, and what the user sees.
  - Acceptance: a failed job can be returned to the queue and delivered exactly once after the failure cause is resolved, and a recovered job that was in fact already delivered still cannot send twice.
  - Decision 2026-07-24: recovery is **operator-confirmed**, not provider-verified. A failure can be ambiguous because the provider may have accepted the message before the response was lost, and only Resend exposes a lookup able to disambiguate. Requiring provider verification would make recovery unavailable on Cloudflare, the default provider. The residual duplicate risk is therefore accepted and disclosed in the confirmation rather than engineered away.
  - Local evidence 2026-07-24: [F61](./specs/F61-outbound-delivery-recovery.md) adds a conditional `failed` → `queued` transition that reuses the existing at-most-once claim rather than adding a second delivery path, a send-capability-scoped `POST /api/messages/{messageId}/retry`, recovery audit columns in migration `0017`, and a confirmed Sent-folder action. Concurrent or repeated recovery cannot double-enqueue because the `status = "failed"` predicate matches at most once. `npm run verify` passes with 1,300 application tests across 151 files at 100% configured coverage plus all 16 bridge tests; the unit tests were observed failing first. Both Chromium recovery scenarios pass, and migration `0017` reaches Drizzle parity on fresh and upgraded databases via the R-33 contract.
  - Production evidence 2026-07-24: migration `0017` applied to `lumimail-prod` (3 commands), and `wrangler d1 migrations list --remote` reports no migrations pending. The OpenNext build and deploy succeeded as version `b16e64d4-31a6-4850-8b55-400a3ff54a30` with 89 ms startup; all three queue producers/consumers, the Cron Trigger, and the custom domain remain bound. `GET /` returned 200 and unauthenticated `POST /api/messages/{id}/retry` returned 401.
  - Production precondition evidence 2026-07-25: the Sent folder contains five messages, all `sent`, and no **Retry delivery** control renders for any of them, matching `canRecoverMessage`. Posting to `/api/messages/{id}/retry` for a `sent` message returned 409 `Message is not in a failed state` and re-sent nothing; an unknown id returned 404 `Message not found`. The conditional claim therefore holds in production.
  - Remaining: one controlled production recovery of a genuinely failed message. Only the refusal paths have been exercised; no message has gone `failed` → `sent`. Producing one requires deliberately failing a send, which was not done to production unprompted. The MVP recoverability gate stays unchecked until an operator performs it.

- [ ] **R-27 Add vacation-responder loop and frequency controls.**
  - Honor standard automated/bulk headers, prevent responses to mailing systems and Lumimail-generated auto-replies, and limit repeat responses per sender/time window.
  - Acceptance: loop fixtures cannot create a reply storm and normal senders receive at most the documented response frequency.

### Phase 3 — Multi-user authorization

- [x] **R-12 Specify mailbox-level access control.** Spec: [F47](./specs/F47-mailbox-access-control.md).
  - Required use case: the owner can access all permitted/catch-all mail while selected users can share `support@kingdomtasks.com` without seeing unrelated mailboxes.
  - Define organization roles, mailbox membership, read/send/admin permissions, catch-all ownership, and invitation behavior.
  - Treat permission defaults and existing-data migration as security decisions requiring explicit review.
  - Evidence 2026-07-22: current endpoint/schema audit recorded in F47; owner self-assignment, shared mailbox state, and the three-role model were explicitly approved.

- [x] **R-13 Implement and enforce mailbox ACLs everywhere.** Depends on R-12.
  - Enforce access server-side for message lists, individual messages, search, attachments, drafts, sending identities, contacts where scoped, and mutations.
  - Hide unauthorized mailboxes in the client, but never rely on client filtering for security.
  - Acceptance: cross-user and cross-tenant negative tests cover every mailbox-scoped endpoint; shared-support-mailbox E2E flow passes.
  - Evidence 2026-07-23: F47 membership lifecycle and UI are deployed. Membership-backed authorization covers browser messages, shared state, attachments, drafts, sender resolution, outbound storage/jobs, and API-key message/send routes. Administrative inventory is separated from content access and its query cache cannot populate the content selector; owner self-claim is explicit; mailbox deletion requires typed exact-address confirmation. Full verification passes at 1,045 tests with 100% coverage, all 24 Playwright tests pass at CI concurrency, and the final OpenNext production build passes. Migration `0010` applied; aggregate verification found 2 organization mailboxes, 2 memberships, and 0 mailbox messages missing organization ownership. Worker `5d3f3c7a-8682-4ebd-84b8-777f8d8d43be` is live and unauthenticated mailbox APIs return JSON `401`. Controlled production validation confirmed all three roles, a direct unrelated-mailbox query returned no rows despite that mailbox containing 5 messages, and removing the assigned mailbox immediately changed a previously readable message to `Not found` and the mailbox list to empty without logout.

- [x] **R-29 Align mail actions and draft visibility with mailbox capabilities.** Spec: [F48](./specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md).
  - Hide viewer-only send/draft affordances and guard direct Compose entry without weakening API authorization.
  - Require send capability for draft metadata and content across generic and dedicated message paths.
  - Refresh visible shared draft lists on a bounded interval without claiming concurrent editing safety.
  - Acceptance: viewer/responder browser contracts, draft-aware authorization tests, full verification, production build, deployment, and controlled live role checks pass.
  - Evidence 2026-07-23: 32 focused unit tests, 1,056-test verification at 100% configured coverage, 28 Playwright scenarios, and the OpenNext production build pass. Worker `7655ecdf-3317-47e8-8d40-4a305ca63ace` is live; `/` returned `200`, and unauthenticated mailbox/draft-list requests returned `401`. Controlled production validation confirmed viewer-only Compose/Drafts removal, direct Compose redirection, responder affordance restoration, and an untouched shared Drafts page automatically changing from 2 rows to 3 when another user saved a draft.

- [x] **R-22 Bind invitations to the intended identity and deliver them safely.** Spec: [F49](./specs/F49-identity-bound-organization-invitations.md).
  - Registration must not accept an invite token for a different address; define whether invited external addresses become login identities or map to domain mailboxes.
  - Deliver or securely share invitations without exposing reusable tokens in ordinary member-list responses.
  - Acceptance: mismatched-address registration is denied and a controlled invited user completes the intended flow end to end.
  - Evidence 2026-07-23: F49 is deployed. The invited external address is server-bound as the login identity, invite acceptance creates no mailbox/routing rule, pending lists omit tokens, raw tokens are revealed once and stored only as SHA-256 hashes, and conditional claiming prevents replay. Production contained 0 unexpired legacy plaintext invitations before deployment. Verification passes with 1,065 tests at 100% configured coverage, all 30 Playwright scenarios, and the final OpenNext build. Commit `bf0375c` is deployed as Worker `f0527542-9628-4905-ab6a-1631485517d4`; production returned `200` for `/`, `401` for unauthenticated member listing, `404` for an invalid invitation, and `400` for malformed invitation registration. Controlled production validation invited `support@lucidkith.org`, created no implicit mailbox, separately assigned responder access to `support@lucidkith.com`, and confirmed a no-hard-refresh login exposed only that mailbox with responder actions.

- [x] **R-30 Isolate browser caches across account switches.** Spec: [F50](./specs/F50-account-switch-cache-isolation.md).
  - Clear mailbox, message, count, TanStack Query, and selected-mailbox state at every successful authentication transition.
  - Prevent requests started under a prior account from repopulating or deleting current-account cache entries.
  - Acceptance: unit and browser account-switch tests pass, and a production logout/login switch shows only the new account without a hard refresh.
  - Evidence 2026-07-23: production reproduced a stale one-mailbox selector after logout/login; a hard refresh restored the owner mailbox list. Code audit found account-agnostic module caches, persistent root query data, and uncleared selected-mailbox storage. F50 added browser-global reset broadcast, canonical auth persistence, cache generations, request identity guards, Query Client reset, and immediate mounted-provider clearing. Verification passed with 1,074 tests at 100% configured coverage, all 31 Playwright scenarios, and the final OpenNext build. Commit `3467284` deployed as Worker `c34cd897-8d39-4364-a4ff-129d0413d4bc`; smoke checks passed, and a controlled invited-user-to-admin switch showed both administrator mailboxes immediately without a hard refresh.

- [x] **R-31 Hide organization administration from restricted members.** Spec: [F51](./specs/F51-restricted-member-admin-navigation.md).
  - Expose the current organization role through the authenticated-session contract.
  - Hide administration links from members and redirect direct member visits before administrative controls render.
  - Keep every administration API protected by `guardOrgAdmin`; client behavior is defense in depth.
  - Acceptance: member/admin unit and browser contracts, full verification, production build, deployment, and controlled no-hard-refresh role checks pass.
  - Evidence 2026-07-23: F49 production validation found that a member could see **Admin settings**, open `/mailboxes`, and see **New mailbox**. The administration API correctly returned `403` and exposed no organization inventory, so this is a client authorization-visibility defect rather than a server authorization bypass. F51 added organization role to the session contract, fail-closed selector visibility, and an owner/admin-only layout gate across all eight administration entry routes. Verification passed with 1,081 tests at 100% configured coverage; all 33 Chromium scenarios reported passing before the known local Wrangler helper kept the runner open until timeout; the final escalated OpenNext build passed. Commit `2dad399` deployed as Worker `8ac50a92-ae5e-4ae0-8d93-3100390a500a`; production smoke checks passed. Controlled member validation confirmed hidden admin navigation and direct `/mailboxes` redirection, while the subsequent no-hard-refresh owner login immediately restored the admin entry, page, and **New mailbox** control.

- [ ] **R-23 Repair and verify the IMAP/SMTP bridge contract.** Depends on R-13 for mailbox authorization.
  - Use API-key-aware endpoints consistently, align scope names and response envelopes, and correct SMTP recipient/body shapes.
  - Define TLS requirements and remove capabilities that are advertised but not implemented.
  - Acceptance: Thunderbird or another controlled client can authenticate, list/fetch/update a permitted mailbox, and send a message without accessing an unauthorized mailbox.
  - Local evidence 2026-07-23: F52 implements mailbox-scoped `/api/v1/*` contracts, persistent UIDs/UIDNEXT, paged IMAP synchronization, truthful capabilities, sender-bound one-recipient SMTP, fail-closed TLS, and restricted-member personal key management. `npm run verify` passes with 1,110 application tests at 100% configured coverage plus 16 bridge tests; the focused Chromium scenario reported passing before the known Wrangler helper timeout; the fresh-D1 migration contract and final OpenNext build pass. Production migration/deployment, a separate TCP host with trusted certificates, and controlled Thunderbird isolation/send validation remain pending.

### Phase 4 — Theme, localization, and interface consistency

- [x] **R-14 Repair missing and inconsistent translation keys.**
  - Correct the missing `auth.continue` contract.
  - Compare all locale key trees with the English base and detect missing keys automatically.
  - Inventory hardcoded user-facing English and migrate it in bounded passes.
  - Acceptance: no interface displays raw translation keys in supported locales.
  - Evidence 2026-07-23: the passing 24-test Playwright run logs missing `actions.delete`, missing `compose.send`/`compose.sending`, and an invalid ICU tag in `compose.recipientsPlaceholder`.
  - Completion evidence 2026-07-24: commit `914793f` added the missing UI translations across all supported locales; the subsequent theme/mobile production review displayed translated interface copy without the previously observed raw keys.

- [x] **R-15 Convert the interface to semantic theme tokens.**
  - Replace fixed light palette usage (`bg-white`, neutral text/borders, and hexadecimal surfaces) with semantic tokens in shared primitives and then feature components.
  - Include dialogs, inputs, navigation, message lists, compose, admin pages, loading/error/empty states, and the global error page.
  - Acceptance: light and dark themes meet contrast requirements and have no mixed-theme surfaces in visual E2E checks.
  - Completion evidence 2026-07-24: F53 replaced hardcoded palette utilities with semantic tokens, passed the full local verification recorded in the spec, and received operator production usability validation after the follow-up typography and responsive-layout repairs.

- [x] **R-16 Add a persistent theme selector.** Depends on R-15.
  - Support light, dark, and system preferences without a flash of the wrong theme.
  - Preserve the selection across sessions where appropriate.
  - Acceptance: selection, persistence, system changes, SSR/hydration, and global error behavior are tested.
  - Completion evidence 2026-07-24: commit `6d4f57a` added persistent System/Light/Dark selection and pre-paint application; production usability validation confirmed the completed theme flow.

### Phase 5 — Operational hardening

- [x] **R-32 Monitor queue health and stale delivery work.** Spec: [F56](./specs/F56-queue-health-monitoring.md).
  - [x] Add one-minute scheduled checks for inbound, outbound, and outbound
    dead-letter aggregate metrics.
  - [x] Persist current D1 snapshots and combine outbound backlog with stale
    queued/processing job detection.
  - [x] Add an owner-only, platform-wide status page and manual check without
    granting automatic resume/purge authority.
  - [x] Apply migration `0013`, deploy the Cron Trigger and metrics-only DLQ
    binding, then confirm scheduled `checkedAt` advances in production.
  - Acceptance: all three queues show fresh scheduled status; an aging backlog or
    dead-letter message becomes actionable without exposing message content.
  - Local evidence 2026-07-24: focused queue/migration/API contracts pass; full
    `npm run verify` passes with 1,206 application tests at 100% configured
    coverage plus 16 bridge tests; four relevant Chromium assertions passed
    before the known local Wrangler helper teardown timeout; fresh local migration,
    OpenNext production build, and Wrangler dry run pass.
  - Production evidence 2026-07-24: migration `0013` is applied; Worker
    `32a2f078-ee99-47d8-a4c2-7c90d12bc84e` is deployed at 100%; version
    inspection confirms `scheduled` plus inbound, outbound, and outbound-DLQ
    bindings. Scheduled D1 snapshots existed and were healthy before manual
    validation. The owner page showed all three queues healthy, and **Check now**
    advanced every timestamp with zero backlog, dead letters, and stale jobs.

- [ ] **R-17 Run a multiple-domain performance and isolation pass.**
  - Seed realistic domains, users, mailboxes, aliases, rules, and messages.
  - Measure bounded pagination, search, routing lookup, mailbox loading, DNS status loading, queue throughput, and D1 query plans.
  - Verify indexes serve organization/domain/mailbox filters and remove N+1 request/query patterns.

- [ ] **R-18 Complete a production readiness exercise.** Depends on all earlier critical items.
  - Test inbound exact address and catch-all for at least `lucidkith.com` and `henriksen.dev`.
  - Test outbound, reply, attachments, drafts, password reset, shared mailbox access, forbidden mailbox access, forwarding if retained, queue retries, and backup/restore.
  - Confirm logs and configured webhooks do not export message content or credentials unexpectedly.
  - Record rollback steps and Cloudflare resource identifiers in private operational documentation, not in committed public files when sensitive.

## Verification log

Add one entry per completed item. Do not record secrets, email contents, reset tokens, API tokens, or private recipient addresses.

| Date | Item | Evidence | Environment | Result |
|---|---|---|---|---|
| 2026-07-22 | R-00 | F36 verification section | Local build/dry run | Passed |
| 2026-07-22 | R-01 | 845 tests, 100% reported coverage; Worker deployed | Local + production | Passed |
| 2026-07-22 | R-02 | Fresh-D1 inspection, production schema inspection, successful registration | Local + production | Passed |
| 2026-07-22 | R-03 | Migration contract test, fresh-D1 metadata inspection, 846-test verification, production migration and metadata inspection | Local + production | Passed |
| 2026-07-22 | R-04 | 15 focused parser tests; 861-test full verification at 100% reported coverage | Local | Passed |
| 2026-07-22 | R-05 | 14 focused contract tests, 870-test full verification, 11 Playwright tests, OpenNext build, Worker `7b6a11f5-9159-40c4-8415-d447393a39fe`, HTTP 200 smoke check | Local + production | Passed |
| 2026-07-22 | R-19 | 16 focused sanitizer/parser tests, 881-test full verification, 12 Playwright tests, OpenNext build, Wrangler dry run, Worker `722ae8e3-bb50-4031-9b96-dfc590a20739`, HTTP smoke checks, controlled reply and non-reply HTML messages | Local + production | Passed |
| 2026-07-22 | R-06 | 7 focused schema tests, fresh local-D1 migration, structural Drizzle comparison, 887-test verification at 100% configured coverage | Local + CI path | Passed |
| 2026-07-22 | R-21 | 28 focused tests, 904-test verification, 16 Playwright tests, build/dry run, Worker `e63887e2-a872-4fe9-8eb2-8d2282a05fef`, controlled recovery and login | Local + production | Passed |
| 2026-07-22 | R-28 | 30 focused tests, 919-test verification at 100% configured coverage, 2 Chromium scenarios, build/dry run, migration `0009`, remote schema inspection, Worker `158f8558-5c94-4849-aceb-730e7e56fae5`, HTTP smoke checks, controlled UI revocation | Local + production | Passed |
| 2026-07-22 | R-07 | 88 focused contracts, 936-test verification at 100% configured coverage, 3 Chromium scenarios, provider/DNS inspection, build/dry run, Worker `d82e393c-1abb-4f68-9719-284eb31c73af`, production reconciliation and smoke checks, prior controlled outbound send | Local + production | Passed |
| 2026-07-22 | R-08 | 985-test verification at 100% configured coverage, 2 Chromium scenarios, build/dry run, Worker `3a99cabe-fbf6-4d1d-b5cb-5df76458b6c2`, provider/D1 inspection, and controlled exact/catch-all delivery across LucidKith and Henriksen | Local + production | Passed |
| 2026-07-24 | R-10 | 1,153-test verification at 100% configured coverage, 35 Chromium scenarios, migration `0012`, outbound DLQ topology, Workers `70e646ad-809e-45b2-8d13-4e0b03c28563` / `73a3d71a-411b-4de7-8ada-0e1decdf39e1`, and a controlled one-attempt queued-to-sent provider delivery | Local + production | Passed |
| 2026-07-24 | R-32 | 1,206-test verification at 100% configured coverage, migration `0013`, scheduled snapshots, three Queue bindings, Worker `32a2f078-ee99-47d8-a4c2-7c90d12bc84e`, and owner-page/manual-refresh validation | Local + production | Passed |
| 2026-07-24 | R-33 | Staged-upgrade migration contract, observed fresh-versus-upgraded asymmetry for an edited applied migration, 1,287-test verification at 100% configured coverage plus 16 bridge tests | Local | Passed |
| 2026-07-24 | R-34 | 1,300-test verification at 100% configured coverage, 2 Chromium recovery scenarios, migration `0017` applied remotely with none pending, version `b16e64d4-31a6-4850-8b55-400a3ff54a30`, HTTP 200/401 smoke checks | Local + production | Deployed; controlled production recovery pending |

## Newly discovered work

Add audit discoveries here before assigning them a priority. Promote each confirmed issue into a numbered checklist item or merge it into an existing item with a note explaining why.

- Next.js 16 warns that the `middleware` file convention is deprecated in favor of `proxy`; triage as a bounded framework-maintenance item.
- Wrangler warns that the `CF_ACCOUNT_ID` environment variable name is deprecated in favor of `CLOUDFLARE_ACCOUNT_ID`; update configuration and runtime access together after confirming compatibility.
- R-14 follow-up completed 2026-07-24: the invalid ICU `compose.recipientsPlaceholder` angle-bracket address was replaced in all 11 locales and a formatting regression test now exercises every locale.
- Session authentication scans every unexpired session and performs a bcrypt comparison for each row; include this in the R-17 performance pass and redesign lookup without weakening token-at-rest protection.
- 2026-07-24 (R-09 scoping, **live mail-loss path**): the routing UI still offers **Forward to address** as a selectable action, `/api/routing-rules` accepts and persists `action: "forward"` with a destination, and `src/lib/email/inbound.ts:46` handles that decision with only `console.info`. An administrator can therefore create a forwarding rule today and the matching mail is silently discarded with no delivery, no failure state, and no user-visible error. `alias-targets.ts` produces the same dead `{ type: "forward" }` targets. This raises R-09's priority: whichever direction is chosen, the creatable-but-inert control must stop accepting rules that drop mail. — Addressed locally by F62; closes when R-09 is verified in production.
- Alias-level external forwarding: `/api/aliases` hardcodes `forwardTo: null` on creation (F60 removed the false claim), so no alias with an external target can be created today and there is no alias mail-loss path. Legacy rows that still carry `forwardTo` are authorized by the same F62 delivery-time rules and will now be forwarded only if owned and verified. Re-enabling alias forwarding in the UI must add the same fail-closed creation check `/api/routing-rules` uses; fold that into R-26.
- The Worker `email()` handler now performs a D1 routing lookup for every inbound message so it can decide forwarding before the queue. Measure this in the R-17 performance pass.
- 2026-07-25, **corrupted production timestamp** — addressed by migration `0019`. `routing_rules.rule_YohOjzpqyI6Ux6oI2CToY` (the LucidKith `*` rule) held `created_at = 1784768200000`, a millisecond value in a column Drizzle reads as seconds, rendering as year 58527. The correct value is `1784768200` (2026-07-23T00:56:40Z).
  - Write-path audit: every application write is correct. `$defaultFn(() => new Date())` converts properly, `seed-utils` and `forgot-password` pass `Date` objects, migration `0010`'s backfill uses `unixepoch()`, and the remaining `Date.now()` uses build an R2 key and an in-memory rate-limit window rather than a column value. **No code path in the repository can produce this corruption**, which confirms it came from hand-run operator SQL — consistent with the R-08 catch-all migration being applied directly.
  - Sweep: migration `0019` normalizes all 41 `{ mode: "timestamp" }` columns with `SET col = col / 1000 WHERE col > 100000000000`. A seconds epoch stays below that guard until the year 5138, so only unambiguous millisecond values are rewritten, and the guard makes the migration idempotent.
  - Guard: `tests/unit/db/timestamp-normalization.test.ts` enumerates timestamp columns from the live Drizzle schema and fails if any is missing from the migration, so a newly added column cannot silently escape the normalization contract.
  - Production evidence 2026-07-25: migration `0019` applied to `lumimail-prod`, executing 42 commands. `rule_YohOjzpqyI6Ux6oI2CToY` now reads `2026-07-23T00:56:40.000Z`, the exact predicted value and 38 minutes before its sibling rule, consistent with a single R-08 work session. Ten message, mailbox, and destination timestamps were re-read afterwards and none fell outside 2020–2100, confirming correct rows were untouched. The authenticated session survived the migration, which independently rules out `sessions.expires_at` having been rewritten.
  - Residual risk: nothing prevents a future operator from writing milliseconds again. The durable mitigation is to avoid hand-run SQL against production; a recurring detection check was not added because D1 rejects the compound `SELECT` such an audit requires even at eight terms.

## Decisions and scope changes

Record decisions that change ordering, security behavior, external providers, billing, retention, or the product’s user-visible contract.

- 2026-07-22: Data integrity and API contract repairs precede new feature work.
- 2026-07-22: Mailbox ACL behavior must be specified before inviting restricted users.
- 2026-07-22: Theme token conversion precedes adding a manual selector so the selector never exposes a knowingly incomplete dark interface.
- 2026-07-22: The MVP registry now distinguishes shipped, partial, in-progress, and blocked behavior; route existence alone is not completion evidence.
- 2026-07-22: Workers-safe HTML sanitization is a P0 security prerequisite and takes precedence over the existing phase order.
- 2026-07-22: F01–F35 were validated against routes, schema, Worker bindings, UI paths, and tests; detailed evidence is recorded in `docs/FEATURE_VALIDATION.md`.
- 2026-07-24: production-readiness gates are checked against re-audited current code, not against the status of the remediation item that originally closed them. Six gates had completed items but stale checkboxes; re-auditing them surfaced two genuine gaps (R-33, R-34) that the item statuses had hidden. Any future gate check must re-audit surfaces added after its originating item.
