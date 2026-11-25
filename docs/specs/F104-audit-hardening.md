# F104 — Mail storage, delivery, and interface hardening

## Current behavior

- Domain provisioning can write to Cloudflare before D1 checks the owning organization. Removing a hostname can disable routing for its whole zone. First-run preview writes provider state before an owner exists.
- First-run registration creates a mailbox without its manager grant. External sync can remove referenced R2 files when post-commit filters fail.
- Outbound jobs can miss their queue notification. An uncertain provider outcome can appear as a definitive failure.
- Remote image reads buffer before enforcing their byte limit. Parsed mail bodies can exceed D1 storage limits.
- Folder counts transfer message rows into the Worker. Folder pagination sorts a time-dependent expression without a stable tie-breaker. Folder load failures look empty, and autosave requests can overlap.
- Scheduled jobs share a serial execution path. Queue handlers infer queue identity from payload shape.

## Desired behavior and decisions

- After bootstrap, domain provisioning requires the instance operator or an organization admin with an exact hostname listed for their organization in `DOMAIN_PROVISIONING_ALLOWLIST`. A successful first-owner claim retains its existing bootstrap permission. Domain preview only checks availability and returns the normalized hostname. Reserve the globally unique hostname before writing provider configuration. A failed provisioning attempt remains associated with its organization for retry. Domain deletion removes scoped routing rules and leaves zone-wide deactivation to the operator in Cloudflare.
- Build mailbox creation and the creator's explicit manager grant in one D1 batch. Repair only matching primary mailboxes of workspace owners that have no memberships, preserving existing grants.
- Mark new imported inbound mail pending for filtering in the import transaction. Clear the marker after successful filters. The cursor waits on failed filtering and replay uses the persisted timestamp. R2 cleanup occurs only before the import commits.
- Reconcile stale outbound jobs from D1. Preserve a distinction between safe retry and uncertain delivery after a provider call. Use stable provider idempotency where available.
- Stop image reads at the size limit and surface upstream body failures. Preserve oversized mail content with bounded storage and compatibility with existing messages.
- Aggregate counts in D1, stabilize folder pagination, and verify the production list query shape against migrated SQLite. Keep existing mailbox filtering and snooze behavior.
- Show retryable folder errors and serialize draft autosave. Expose failure and current save state in the composer.
- Dispatch queues by configured identity and validate their payloads. Isolate webhook delivery and MIME repair from essential maintenance and record content-free task outcomes.

## Operational and interface details

- Existing installations need D1 migrations `0050` and `0051` before deploying. The repair grants access only to a matching primary mailbox with no memberships, created by its workspace owner in the same organization.
- Domain removal preserves the D1 row when scoped Cloudflare rule cleanup fails. Zone-wide disablement is an operator operation in Cloudflare. Configure `INSTANCE_OPERATOR_USER_ID` or the organization-to-hostnames allowlist before provisioning additional domains.
- Initial submission and confirmed recovery can report `queued` once the D1 job is durable. Scheduled reconciliation wakes jobs queued for two minutes. It records attempts still processing after twenty minutes as `uncertain`. A user with send access can explicitly retry an uncertain attempt. Resend receives a stable job idempotency key.
- Oversized received and repaired mail stores a plain-text preview in D1 and places the complete parsed text and sanitized HTML in downloadable R2 attachments. SQL body filters search the preview. External raw MIME retention follows the account preference.
- Inbox order uses wake time for received mail that has unsnoozed. Other statuses use creation time. A message ID breaks timestamp ties. The browser uses an `after` cursor on next-page navigation. The HTTP API also accepts offset pagination, and the total remains exact across the authorized view.
- Merge the three cron expressions and `ISOLATED_MAINTENANCE_CRONS` from `wrangler.jsonc.example` into existing configuration together. An installation with its original minute trigger can continue running maintenance in one invocation. Custom queues can configure `QUEUE_NAME_PREFIX` and `QUEUE_NAME_SUFFIX`.

## Edge cases and verification

- Cover conflicting organizations, concurrent claims, an unavailable Cloudflare zone, and sibling hostnames sharing a zone.
- Cover registration with no mailbox grant, migration on legacy rows, filter failure after commit, replay, and queue publication interruption.
- Cover oversized streamed data, provider uncertainty, equivalent mailbox counts, stable pagination across tied timestamps, and UI retry and save failure behavior.
- Run `npm run verify` and `npm run e2e`. Record production-only checks separately.

## Bug and change log

- 2026-11-24. Applied the hardening changes above. `npm run verify` passed with 3,010 tests, 100% enforced coverage, the complexity check, and 21 IMAP bridge tests. All 134 Chromium tests passed. The migrated SQLite query plans use the inbox sort index for both the initial page and a later cursor. Live Cloudflare mail and scheduler verification remain pending deployment.
