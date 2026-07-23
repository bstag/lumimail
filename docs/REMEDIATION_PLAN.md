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

- [ ] **R-09 Implement actual external forwarding or remove the claim.**
  - Current forwarding behavior only records/logs the action.
  - Specify loop prevention, sender rewriting, authentication/deliverability behavior, failure handling, and audit visibility before implementation.
  - Acceptance: a controlled external recipient receives the forwarded message and failures are observable and retry-safe.

- [ ] **R-10 Connect outbound sending to the configured queue.**
  - Define synchronous acknowledgement, retry policy, idempotency, dead-letter handling, and user-visible delivery states.
  - Acceptance: HTTP requests enqueue rather than perform provider delivery inline, and duplicate queue delivery cannot send duplicate mail.

- [ ] **R-11 Prevent orphaned raw inbound objects.**
  - Define retention for unroutable, rejected, failed, and successfully processed messages.
  - Acceptance: every R2 object reaches an intentional retained or deleted state, with retry-safe cleanup and tests.

- [ ] **R-20 Include attachments in outbound message delivery.**
  - Define the outbound transaction so validated attachments are available before provider delivery and are encoded into the provider request/MIME message.
  - Specify size/type limits, partial-failure behavior, cleanup, API-key send behavior, reply/forward behavior, and retry/idempotency interaction with R-10.
  - Acceptance: a controlled recipient receives the attachment with the expected filename, content type, and bytes; a failed send cannot leave a misleading sent message.

- [ ] **R-24 Ingest inbound MIME attachments.** Coordinates with R-20.
  - Parse attachment parts, store their bytes in R2, create metadata rows, and define cleanup when any step fails.
  - Acceptance: controlled inbound image, PDF, and binary fixtures can be listed and downloaded with exact bytes and safe content headers.

- [ ] **R-25 Implement RFC-aware conversation grouping.**
  - Parse Message-ID, In-Reply-To, and References; define stable thread assignment for inbound and outbound messages.
  - Define how the newest sanitized HTML reply is displayed when a plain-text alternative contains quoted-history markers; the current UI discards HTML whenever quoted text is detected.
  - Acceptance: a traced multi-message reply chain renders as one thread without merging unrelated messages.

- [ ] **R-26 Complete alias and group provisioning.** Coordinates with R-08 and R-09.
  - Provision Cloudflare delivery for alias addresses and add organization-admin UI/API behavior for group membership.
  - Acceptance: internal aliases and multi-member groups created entirely through Lumimail receive a controlled inbound message without manual Cloudflare rule creation.

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

- [ ] **R-31 Hide organization administration from restricted members.** Spec: [F51](./specs/F51-restricted-member-admin-navigation.md).
  - Expose the current organization role through the authenticated-session contract.
  - Hide administration links from members and redirect direct member visits before administrative controls render.
  - Keep every administration API protected by `guardOrgAdmin`; client behavior is defense in depth.
  - Acceptance: member/admin unit and browser contracts, full verification, production build, deployment, and controlled no-hard-refresh role checks pass.
  - Evidence 2026-07-23: F49 production validation found that a member could see **Admin settings**, open `/mailboxes`, and see **New mailbox**. The administration API correctly returned `403` and exposed no organization inventory, so this is a client authorization-visibility defect rather than a server authorization bypass.

- [ ] **R-23 Repair and verify the IMAP/SMTP bridge contract.** Depends on R-13 for mailbox authorization.
  - Use API-key-aware endpoints consistently, align scope names and response envelopes, and correct SMTP recipient/body shapes.
  - Define TLS requirements and remove capabilities that are advertised but not implemented.
  - Acceptance: Thunderbird or another controlled client can authenticate, list/fetch/update a permitted mailbox, and send a message without accessing an unauthorized mailbox.

### Phase 4 — Theme, localization, and interface consistency

- [ ] **R-14 Repair missing and inconsistent translation keys.**
  - Correct the missing `auth.continue` contract.
  - Compare all locale key trees with the English base and detect missing keys automatically.
  - Inventory hardcoded user-facing English and migrate it in bounded passes.
  - Acceptance: no interface displays raw translation keys in supported locales.
  - Evidence 2026-07-23: the passing 24-test Playwright run logs missing `actions.delete`, missing `compose.send`/`compose.sending`, and an invalid ICU tag in `compose.recipientsPlaceholder`.

- [ ] **R-15 Convert the interface to semantic theme tokens.**
  - Replace fixed light palette usage (`bg-white`, neutral text/borders, and hexadecimal surfaces) with semantic tokens in shared primitives and then feature components.
  - Include dialogs, inputs, navigation, message lists, compose, admin pages, loading/error/empty states, and the global error page.
  - Acceptance: light and dark themes meet contrast requirements and have no mixed-theme surfaces in visual E2E checks.

- [ ] **R-16 Add a persistent theme selector.** Depends on R-15.
  - Support light, dark, and system preferences without a flash of the wrong theme.
  - Preserve the selection across sessions where appropriate.
  - Acceptance: selection, persistence, system changes, SSR/hydration, and global error behavior are tested.

### Phase 5 — Operational hardening

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

## Newly discovered work

Add audit discoveries here before assigning them a priority. Promote each confirmed issue into a numbered checklist item or merge it into an existing item with a note explaining why.

- Next.js 16 warns that the `middleware` file convention is deprecated in favor of `proxy`; triage as a bounded framework-maintenance item.
- Wrangler warns that the `CF_ACCOUNT_ID` environment variable name is deprecated in favor of `CLOUDFLARE_ACCOUNT_ID`; update configuration and runtime access together after confirming compatibility.
- R-14 must include missing `compose.send` and the invalid ICU message in `compose.recipientsPlaceholder`, whose literal angle-bracket address is interpreted as a rich-text tag.
- Session authentication scans every unexpired session and performs a bcrypt comparison for each row; include this in the R-17 performance pass and redesign lookup without weakening token-at-rest protection.

## Decisions and scope changes

Record decisions that change ordering, security behavior, external providers, billing, retention, or the product’s user-visible contract.

- 2026-07-22: Data integrity and API contract repairs precede new feature work.
- 2026-07-22: Mailbox ACL behavior must be specified before inviting restricted users.
- 2026-07-22: Theme token conversion precedes adding a manual selector so the selector never exposes a knowingly incomplete dark interface.
- 2026-07-22: The MVP registry now distinguishes shipped, partial, in-progress, and blocked behavior; route existence alone is not completion evidence.
- 2026-07-22: Workers-safe HTML sanitization is a P0 security prerequisite and takes precedence over the existing phase order.
- 2026-07-22: F01–F35 were validated against routes, schema, Worker bindings, UI paths, and tests; detailed evidence is recorded in `docs/FEATURE_VALIDATION.md`.
