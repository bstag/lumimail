# Lumimail — MVP Scope and Feature Registry

Lumimail is a self-hosted, multi-domain email application deployed on Cloudflare.
Its intended MVP is an organization workspace where administrators connect domains,
create mailboxes and aliases, receive and send mail, and grant users access only to
the mailboxes they are allowed to use.

The application is deployed and several core flows work, but the complete MVP is
**not yet production-ready**. This registry distinguishes implemented code from an
end-to-end, tested product contract.

## Status definitions

- `Shipped`: the bounded behavior named in this table is implemented and verified.
- `Partially Shipped`: useful behavior works, but a material part of the stated contract does not.
- `In Progress`: implementation exists, but the feature contract is incomplete or not adequately verified.
- `Blocked`: the implementation has a known security or correctness defect that prevents safe use.
- `Planned`: accepted scope without a completed implementation.
- `Out of scope`: deliberately excluded from this MVP.

A `Shipped` row does not make the whole product production-ready. The production
gates later in this document must also pass.

## Feature matrix

| ID | Feature | Status | Spec | Routes / integration | Known boundary |
|----|---------|--------|------|----------------------|----------------|
| F01 | Core auth: register, login, session, invite acceptance | Shipped | [F01](specs/F01-auth.md) | `/login`, `/register`, `/api/auth/*` | Password recovery is tracked separately as F21. |
| F02 | Domain management and Cloudflare provisioning | Partially Shipped | [F02](specs/F02-domains.md), [F45](specs/F45-cloudflare-sending-domain-readiness.md) | `/domains`, `/api/domains*`, `/api/setup/*` | Apex/nested sending readiness is provider-backed and production-verified; domain administration still lacks role enforcement for restricted members. |
| F03 | Organization-scoped mailbox CRUD | Shipped | [F03](specs/F03-mailboxes.md), [F47](specs/F47-mailbox-access-control.md) | `/mailboxes`, `/api/admin/mailboxes`, `/api/mailboxes*` | Organization admins provision and delete mailboxes; content/settings access requires explicit mailbox membership. Unrelated-mailbox isolation and immediate live revocation are production-verified. |
| F04 | Mail folders: inbox, sent, drafts, spam, trash, starred | Shipped | [F04](specs/F04-mail-folders.md) | dashboard folders, `/api/messages*` | — |
| F05 | Plain-text compose, provider send, drafts, attachment UI | Shipped | [F05](specs/F05-compose-send.md), [F48](specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md), [F55](specs/F55-outbound-attachment-delivery.md) | `/compose`, `/api/send`, `/api/drafts*`, `/api/v1/send` | Shared mailbox drafts are capability-scoped; atomic outbound attachment storage, queue loading, Cloudflare/Resend encoding, exact R2 bytes, and external-recipient delivery are production-verified. Newly selected files are intentionally not persisted by draft autosave. |
| F06 | API keys | Shipped | [F06](specs/F06-api-keys.md), [F44](specs/F44-api-key-lifecycle.md) | `/api-keys`, `/api/api-keys`, `/api/v1/send` | Keys are created with a one-time secret, lifecycle metadata is visible, and owner-scoped permanent revocation is enforced during authentication. |
| F07 | Inbound routing rules and catch-all | Shipped | [F46](specs/F46-domain-catch-all-routing.md) | `/routing`, `/api/routing-rules*` | Canonical per-domain rules, safe Cloudflare catch-all provisioning, and named-recipient precedence are deployed and production-verified with controlled exact/catch-all delivery across LucidKith and Henriksen. |
| F08 | Webhooks | Shipped | Missing | `/webhooks`, `/api/webhooks*` | Payload/privacy behavior must be included in the production data-export audit. |
| F09 | Settings and profile | Shipped | [F09](specs/F09-settings.md) | `/settings`, `/api/settings/profile` | — |
| F10 | Seed/demo data | Shipped (development only) | Missing | `/api/seed` | Must not be exposed as a production capability. |
| F11 | Email agent: AI triage and smart inbox | Out of scope | — | — | — |
| F12 | Multi-user workspace: organizations, invites, roles, mailbox access | In Progress | [F12](specs/F12-multi-user-workspace.md), [F47](specs/F47-mailbox-access-control.md), [F48](specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md), [F49](specs/F49-identity-bound-organization-invitations.md), [F50](specs/F50-account-switch-cache-isolation.md), [F51](specs/F51-restricted-member-admin-navigation.md) | `/members`, `/api/org/members*`, mailbox-scoped APIs | Least-privilege mailbox ACLs, role-aware actions, draft privacy, revocation, shared-draft refresh, identity-bound invitation acceptance, explicit mailbox assignment, restricted invited-user login, cross-account browser-cache isolation, and restricted-member admin navigation are production-verified. Invitations remain copy-link rather than emailed. |
| F51 | Restricted-member administration navigation | Shipped | [F51](specs/F51-restricted-member-admin-navigation.md) | mailbox selector, `(admin)` layout, `/api/auth/me` | Members fail closed without the admin selector entry and direct admin routes redirect before controls render; retained owner access and a no-hard-refresh member-to-owner switch are production-verified. |
| F53 | Theme token consistency (light + dark) | Shipped | [F53](specs/F53-theme-token-consistency.md) | `src/app/globals.css`, all pages/components | Semantic tokens, persistent System/Light/Dark selection, responsive repairs, and production usability validation are complete. |
| F54 | Durable outbound delivery | Shipped | [F54](specs/F54-durable-outbound-delivery.md) | `/api/send`, `/api/v1/send`, `OUTBOUND_QUEUE`, Sent UI | Queue producer/consumer, idempotent claim, classified retries, DLQ finalization, and queued/failed UI are verified; migration `0012`, all queue consumers, and a one-attempt production queued-to-sent provider delivery are confirmed. |
| F55 | Outbound attachment delivery | Shipped | [F55](specs/F55-outbound-attachment-delivery.md) | compose, `/api/send`, `/api/v1/send`, R2, `OUTBOUND_QUEUE`, Cloudflare/Resend providers | Atomic acceptance, compensation, immutable metadata, exact-byte loading, and both provider adapters pass full verification; controlled production delivery preserved the filename, type, size, and exact R2 bytes and arrived at the external recipient. |
| F63 | R2 retention and orphan cleanup | In Progress | [F63](specs/F63-r2-retention-and-cleanup.md) | inbound consumer, `src/lib/r2-retention.ts`, `/api/admin/r2-retention`, Cron Trigger | Raw MIME is deleted once processing succeeds; unreferenced objects older than 7 days are sweepable. Deployed with the sweep enabled after the report showed zero orphans. R-11 stays open until a real orphan is swept, since the deletion path has not run against live data. |
| F62 | External forwarding via Cloudflare Email Routing | Shipped | [F62](specs/F62-external-forwarding.md) | `worker.ts` `email()`, `/api/forwarding-destinations`, `/routing`, `/api/routing-rules` | Forwarding is performed by `message.forward()` at receive time and authorized by organization-owned, Cloudflare-verified destinations; rules naming an unowned or unverified destination are refused, and an undeliverable forward is rejected at SMTP rather than dropped. Migration `0018` is applied and a controlled message was forwarded to a verified external destination. |
| F61 | Operator-confirmed outbound delivery recovery | Shipped | [F61](specs/F61-outbound-delivery-recovery.md) | `/api/messages/[messageId]/retry`, Sent UI, `OUTBOUND_QUEUE` | A failed outbound job can be returned to the queue by a send-capable user after explicit confirmation. Recovery reuses the existing at-most-once claim, so duplicate enqueueing is impossible; an *ambiguous* provider failure can still duplicate, which is disclosed rather than prevented. Migration `0017` is applied and a controlled production recovery moved a genuinely failed message to `sent` with a provider message ID, one operator recovery, and no error. |
| F56 | Scheduled queue health monitoring | Shipped | [F56](specs/F56-queue-health-monitoring.md) | Worker Cron Trigger, Queue metrics, `/queue-health`, `/api/admin/queue-health` | Owner-only platform status, one-minute snapshots, dead-letter visibility, stale-job detection, and manual checks are locally and production-verified. Exact administrative pause state and automatic resume are deliberately excluded. |
| F57 | Inbound attachment ingestion | Shipped | [F57](specs/F57-inbound-attachment-ingestion.md) | PostalMime, inbound queue, R2, message attachment APIs/UI | Bounded exact-byte ingestion, atomic D1 metadata, R2 compensation, omission status, safe previews, and controlled production receipt/download are verified. |
| F13 | IMAP/SMTP bridge for email clients | In Progress | [F13](specs/F13-imap-smtp-bridge.md), [F52](specs/F52-imap-smtp-bridge-contract-repair.md) | `/api/v1/session`, `/api/v1/messages*`, `/api/v1/send`, separate `imap-bridge` service | The mailbox-scoped API, persistent UID, truthful protocol, TLS, sender-binding, personal-key UI, and automated bridge contracts pass locally. Production bridge hosting, TLS, and controlled Thunderbird isolation/send validation remain required. |
| F14 | Starred messages | Shipped | Missing | `/starred`, `/api/messages/[id]/starred` | — |
| F15 | Labels | Shipped | Missing | `/labels`, `/api/labels*` | — |
| F16 | Email aliases | Shipped | [F60](specs/F60-internal-alias-and-group-provisioning.md) | `/aliases`, `/api/aliases*`, Cloudflare Email Routing | Internal mailbox aliases now provision exact Worker rules and support same-organization cross-domain targets. Migration `0016` is deployed and controlled delivery is verified. External forwarding is now real and tracked separately as F62. |
| F17 | Attachment storage, download, and metadata in R2 | Shipped | [F55](specs/F55-outbound-attachment-delivery.md), [F57](specs/F57-inbound-attachment-ingestion.md) | `/api/attachments*`, `/api/messages/[id]/attachments`, inbound/outbound queues | Outbound delivery and inbound exact-byte extraction, storage, listing, preview, and download are production-verified. |
| F18 | Conversation/thread view | Shipped | [F58](specs/F58-rfc-aware-conversation-grouping.md), [F59](specs/F59-html-preserving-replies.md) | `/inbox/[id]`, `/api/messages/thread/[threadId]`, compose/drafts/send queues | RFC grouping and server-derived HTML-preserving replies are deployed and production-verified with a controlled three-message chain. Rich-text authoring and style/color support remain separate future work. |
| F19 | Message search | Shipped | Missing | `/api/messages?q=` | Multiple-domain performance remains unmeasured. |
| F20 | Auto-captured contacts | Shipped | Missing | inbound/outbound hooks | — |
| F21 | Password reset | Shipped | [F43](specs/F43-password-recovery.md) | `/forgot-password`, `/reset-password`, `/api/auth/forgot-password`, `/api/auth/reset-password` | Non-enumerating recovery, one-time token claiming, recovery-email delivery, session revocation, and production login verified. |
| F22 | Contacts UI | Shipped | Missing | `/contacts`, `/api/contacts` | — |
| F23 | Label filtering in message lists | Shipped | Missing | label chips, `/api/messages?labelId=` | — |
| F24 | Email filters/rules | Shipped | Missing | `/filters`, `/api/filters*` | — |
| F25 | Vacation responder | Shipped | [F64](specs/F64-vacation-responder-safety.md) | `/settings`, `/api/vacation`, inbound queue | Loop suppression (RFC 3834 markers, bulk/list headers, bounces, automated senders) and a 4-day per-correspondent window are implemented and locally verified; replies now identify themselves as automatic. A controlled production two-responder exchange produced exactly one reply and then terminated. Per-mailbox scoping and the 4-day window are deployed but not separately exercised in production. |
| F26 | Reply and user-initiated forward composition | Shipped | Missing | `/inbox/[id]`, `/compose` | This is distinct from automatic external alias forwarding in F16/F30. |
| F27 | Inline attachment list | Shipped | [F57](specs/F57-inbound-attachment-ingestion.md) | `/inbox/[id]`, attachment APIs | Received-file rows, sizes, downloads, and truthful omission warnings are verified locally; ordinary received-file listing is production-verified. |
| F28 | Password change for authenticated users | Shipped | Missing | `/settings`, `/api/auth/change-password` | — |
| F29 | Bulk actions and pagination | Shipped | Missing | message-list toolbar, `/api/messages/bulk` | — |
| F30 | Group aliases and fan-out delivery | Shipped | [F60](specs/F60-internal-alias-and-group-provisioning.md) | `/aliases`, `/api/aliases*`, inbound routing | Explicit 2–50 mailbox groups, membership editing, bounded cross-domain fan-out, and exact Cloudflare provisioning are deployed with migration `0016`; a controlled cross-domain group delivered to members on two domains. External group members remain out of scope. |
| F31 | Inline image/PDF preview | Shipped | [F57](specs/F57-inbound-attachment-ingestion.md) | `/inbox/[id]`, `/api/attachments/[id]?disposition=inline` | Explicit JPEG/PNG/GIF/WebP/PDF previews with CSP and `nosniff` are deployed; active types are forced to download; controlled PDF/JPEG rendering is production-verified. |
| F32 | Mobile-responsive UI | Shipped | Missing | dashboard and admin layouts | Theme consistency is tracked separately in the remediation plan. |
| F33 | Pluggable outbound providers: Cloudflare and Resend | Shipped | [F33](specs/F33-outbound-mail-providers.md) | send APIs via `MAIL_PROVIDER` | Queueing/retry and domain provisioning are separate production gates. |
| F34 | Workers-compatible inbound HTML sanitization | Shipped | [F34](specs/F34-workers-html-sanitization.md) | inbound parsing, message view | Strict formatting/link allowlist, remote-resource removal, fail-closed storage sanitization, and browser defense are verified locally and in production. |
| F35 | Installable PWA shell | Shipped | [F35](specs/F35-pwa-installability.md) | global app shell | Mailbox data remains network-only. |

Implementation notes for shipped features live in `docs/implementation/`, but those
notes are not substitutes for feature specifications and executable tests.
The code-level evidence for every row is recorded in
[FEATURE_VALIDATION.md](FEATURE_VALIDATION.md).

## What is operational now

- Registration, login, sessions, organization creation, and the first production migration path.
- Domain and mailbox administration, including Cloudflare inbound routing setup for a connected zone.
- Inbound message ingestion through the Worker, queue, D1 metadata, and R2 raw-message storage.
- Basic message lists, folders, threads, search, labels, filters, contacts, drafts, and plain-text composition.
- Provider-selected outbound sending when the sending domain/provider is already validly configured.
- Internal aliases and internal group delivery.

These capabilities are suitable for continued controlled setup and testing. They do
not yet support the promised restricted-user/shared-mailbox model safely.

## MVP blockers and required remediation

The following work is required before describing Lumimail as a production-ready
multi-domain, multi-user email replacement.

| Priority | Required outcome | Why it blocks the MVP | Tracking |
|----------|------------------|-----------------------|----------|
| P0 | Sanitize hostile inbound HTML safely on Workers | A received email can currently persist active HTML and expose viewers to stored XSS. | [R-19](REMEDIATION_PLAN.md#priority-override--security) |
| P0 | Prove executable migrations match the application schema | A fresh or upgraded deployment can otherwise fail at runtime despite a successful build. | [R-06](REMEDIATION_PLAN.md#phase-1--data-integrity-and-api-contracts) — completed 2026-07-22 |
| P0 | Specify and enforce mailbox ACLs | Restricted users and a shared `support@` mailbox cannot be isolated safely with organization roles alone. | [R-12/R-13](REMEDIATION_PLAN.md#phase-3--multi-user-authorization) |
| P1 | Make domain sending state truthful and usable | Provider-backed apex/nested onboarding, verification, and production reconciliation are complete. | [R-07](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) — completed 2026-07-22 |
| P1 | Define and verify catch-all behavior per domain | Ambiguous accepted patterns can silently misroute or drop mail. | [R-08](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) |
| P1 | Include attachments in outbound delivery | Atomic R2/queue/provider delivery and external-recipient receipt are production-verified. | [R-20](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) — completed 2026-07-24 |
| P1 | Complete password recovery UI and email delivery | A production user who loses a password has no usable recovery flow. | [R-21](REMEDIATION_PLAN.md#phase-1--data-integrity-and-api-contracts) — completed 2026-07-22 |
| P1 | Implement forwarding or remove it from the product contract | External alias/group targets currently log rather than receive messages. | [R-09](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) |
| P1 | Queue outbound mail with idempotent retries and failure visibility | Synchronous provider calls lack durable delivery and duplicate protection. | [R-10](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) — completed 2026-07-24 |
| P1 | Establish intentional R2 retention/cleanup | Failed or unroutable inbound messages can leave orphaned raw objects. | [R-11](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) |
| P2 | Repair localization and implement a complete theme contract | Raw keys, invalid ICU text, and fixed light colors make the interface inconsistent. | [R-14–R-16](REMEDIATION_PLAN.md#phase-4--theme-localization-and-interface-consistency) |
| P2 | Verify multi-domain scale, recovery, rollback, and data export | Operational behavior and privacy must be demonstrated, not inferred from code. | [R-17/R-18](REMEDIATION_PLAN.md#phase-5--operational-hardening) |

## Production-readiness gates

All of these must be checked before a general production launch:

- [x] Hostile HTML, links, and inline content are rendered without executable content or credential leakage.
- [x] A fresh D1 database and an upgraded production-like database both pass automated schema verification.
- [x] Exact-address and catch-all inbound delivery pass across at least two domains, including precedence and no-match cases.
- [x] Outbound, reply, drafts, and attachments reach controlled recipients with observable delivery/failure state.
- [x] Retried queue events cannot send duplicate mail, and terminal failures are recoverable.
- [x] Restricted users cannot enumerate, read, search, download from, or send as unauthorized mailboxes.
- [x] Two or more users can share one mailbox without receiving access to unrelated mailboxes.
- [x] Password recovery works end to end in production without exposing reset tokens.
- [ ] Backup, restore, retention, cleanup, and rollback procedures have been exercised.
- [ ] Logs, webhooks, and third-party providers have a documented data-egress inventory with no unexpected message or credential export.
- [ ] Multiple-domain load and D1 query plans meet documented performance targets.
- [ ] `npm run verify`, the required E2E suite, deployment smoke tests, and traced mail-flow tests pass.

### Gate reconciliation 2026-07-24

Five gates were checked after re-reading their evidence against current code rather
than against remediation-item status alone. Each remediation item that closed a gate
predates later features, so the newer surfaces were re-audited:

| Gate | Basis | Re-audit performed |
|------|-------|--------------------|
| Hostile HTML/links/inline content | R-19 adversarial sanitizer tests plus controlled production remote-image and safe-formatting messages | `src/lib/email/sanitize.ts` drops `form`, `img`, `iframe`, `style`, `svg`, `object`, and `input` subtrees, so neither remote-resource beaconing nor credential-collecting markup survives. F31 inline previews add `sandbox` CSP and `nosniff`. |
| Outbound, reply, drafts, attachments | R-10 queued-to-sent provider delivery, R-20 controlled attachment receipt with matching R2 SHA-256, R-25 three-message production reply chain, R-29 shared-draft production validation | Delivery state remains visible as queued/sent/failed. |
| Restricted-user isolation | R-13 controlled production validation | Every mailbox-scoped read path added after R-13 was re-audited: message list, counts, search, thread (F58), bulk, starred, labels, attachment listing and download (F55/F57), and the `/api/v1` bridge routes all apply `messageAccessCondition`. Draft paths require the `send` capability. |
| Shared mailbox without unrelated access | R-13 and R-29 controlled production validation | Same membership condition; no bypassing path found. |
| Fresh and upgraded schema verification | R-06 fresh-database contract, extended by R-33 | The reconciliation found only fresh databases were verified, so F42 gained a staged-upgrade contract. Applying `0014`–`0016` to a database already at `0013` now reaches exact Drizzle parity, and an edit to an already-applied migration is detected. |

### Gate 12 clause status 2026-07-25

The final gate covers four separate things and is checked only when all four hold:

| Clause | Status |
|--------|--------|
| `npm run verify` | Passing — 1,463 tests at 100% configured coverage. |
| Required E2E suite | Passing — 46 mocked scenarios and 29 authenticated scenarios against the real local backend, stable across repeated runs. |
| Deployment smoke tests | Not automated. Every deployment records ad-hoc HTTP 200/401 checks in the remediation log; there is no repeatable script, so this is an operator habit rather than a test. |
| Traced mail-flow tests | Absent. No automated test follows a message from inbound receipt through storage to outbound reply with a traceable identifier. |

The two failing clauses need work that does not exist yet, so the gate stays unchecked.

One gate remains deliberately unchecked because the evidence does not support it:

- **Terminal failure recoverability** is unimplemented. Duplicate suppression and
  classified retry are covered by deterministic tests, but `processOutboundDeadLetter`
  only marks a job `failed`; no requeue, resend, or operator recovery path exists in
  `src/`. Tracked as [R-34](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness).

## Specification coverage debt

The registry currently has shipped or partially shipped behaviors without numbered
specifications: F08, F10, and F14–F32. Those features need specs defining their
actual security, tenant-isolation, error, and test contracts before they can be
considered fully documented.

Additional registry hygiene required:

- Resolve the duplicate F02 identifier currently used by the unrelated GitHub CI specification.
- Reconcile stale statuses in F01, F12, F13, and F34 specifications with verified behavior.
- Ensure each future status change records test and deployment evidence rather than relying on route existence.

## Post-MVP enhancements

| Feature | Notes |
|---------|-------|
| Rich-text HTML composition | Current composition is plain text. |
| IMAP IDLE / server-side push | The bridge currently polls. |
| Snooze and scheduled send | Convenience features beyond core reliable mail. |
| Additional identity providers / SSO | Useful for larger organizations after mailbox ACLs are complete. |

## Adding or changing a feature

1. Add a `Planned` row and create a specification from `docs/specs/TEMPLATE.md`.
2. Define current and desired behavior, edge cases, errors, permissions, and tests.
3. Write failing tests before implementation.
4. Implement the smallest correct change.
5. Run `npm run verify`, plus `npm run e2e` for user-visible behavior.
6. Update the specification, this registry, and the remediation checklist where applicable.
7. Mark a feature `Shipped` only when its bounded contract and required tests pass.

## Conventions

- **Stack:** Next.js 16 App Router on Cloudflare Workers via OpenNext, Drizzle ORM + D1, Tailwind v4, shadcn/Radix UI, TanStack Query, and Zod.
- **Auth:** session cookie in `src/lib/auth/`; database access via `getDb(env)`.
- **Validation:** request bodies use Zod schemas in `src/lib/validators.ts`.
- **IDs:** `newId(prefix)` from `src/lib/ids.ts`.
- **Tenant isolation:** every organization- and mailbox-scoped operation must enforce authorization server-side and have negative tests.
