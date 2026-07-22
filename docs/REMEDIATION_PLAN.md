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

- [ ] **R-06 Add automated migration/schema drift detection.** Depends on R-03.
  - Apply the executable SQL migrations to an empty local D1 database in CI/test setup.
  - Compare the resulting tables, columns, indexes, and foreign keys with the expected Drizzle schema.
  - Acceptance: removing a required executable migration statement makes the check fail even when Drizzle snapshots remain valid.

### Phase 2 — Sending and routing correctness

- [ ] **R-07 Make apex-domain sending provisioning truthful and usable.**
  - Determine the supported Cloudflare Email Sending configuration for an apex zone such as `lucidkith.com`.
  - Never report a domain as sending-enabled unless provisioning and verification succeeded.
  - Surface actionable DNS/provider status in the interface.
  - Acceptance: send a traced test message from the configured domain and record provider/DNS verification evidence without storing message content in this document.

- [ ] **R-08 Make catch-all syntax unambiguous.**
  - Define whether the canonical catch-all is `*`, `*@domain`, or both.
  - Normalize accepted input or reject unsupported patterns.
  - Test exact address, local-part, catch-all, precedence, and no-match behavior across multiple domains.

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

### Phase 3 — Multi-user authorization

- [ ] **R-12 Specify mailbox-level access control.**
  - Required use case: the owner can access all permitted/catch-all mail while selected users can share `support@kingdomtasks.com` without seeing unrelated mailboxes.
  - Define organization roles, mailbox membership, read/send/admin permissions, catch-all ownership, and invitation behavior.
  - Treat permission defaults and existing-data migration as security decisions requiring explicit review.

- [ ] **R-13 Implement and enforce mailbox ACLs everywhere.** Depends on R-12.
  - Enforce access server-side for message lists, individual messages, search, attachments, drafts, sending identities, contacts where scoped, and mutations.
  - Hide unauthorized mailboxes in the client, but never rely on client filtering for security.
  - Acceptance: cross-user and cross-tenant negative tests cover every mailbox-scoped endpoint; shared-support-mailbox E2E flow passes.

### Phase 4 — Theme, localization, and interface consistency

- [ ] **R-14 Repair missing and inconsistent translation keys.**
  - Correct the missing `auth.continue` contract.
  - Compare all locale key trees with the English base and detect missing keys automatically.
  - Inventory hardcoded user-facing English and migrate it in bounded passes.
  - Acceptance: no interface displays raw translation keys in supported locales.

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

## Newly discovered work

Add audit discoveries here before assigning them a priority. Promote each confirmed issue into a numbered checklist item or merge it into an existing item with a note explaining why.

- Next.js 16 warns that the `middleware` file convention is deprecated in favor of `proxy`; triage as a bounded framework-maintenance item.
- Wrangler warns that the `CF_ACCOUNT_ID` environment variable name is deprecated in favor of `CLOUDFLARE_ACCOUNT_ID`; update configuration and runtime access together after confirming compatibility.
- R-14 must include missing `compose.send` and the invalid ICU message in `compose.recipientsPlaceholder`, whose literal angle-bracket address is interpreted as a rich-text tag.

## Decisions and scope changes

Record decisions that change ordering, security behavior, external providers, billing, retention, or the product’s user-visible contract.

- 2026-07-22: Data integrity and API contract repairs precede new feature work.
- 2026-07-22: Mailbox ACL behavior must be specified before inviting restricted users.
- 2026-07-22: Theme token conversion precedes adding a manual selector so the selector never exposes a knowingly incomplete dark interface.
