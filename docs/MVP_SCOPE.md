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
| F02 | Domain management and Cloudflare provisioning | Shipped | [F02](specs/F02-domains.md), [F45](specs/F45-cloudflare-sending-domain-readiness.md) | `/domains`, `/api/domains*`, `/api/setup/*` | Apex/nested sending readiness is provider-backed and production-verified. Every collection/detail/DNS/sending domain method is owner/admin-only; migrated-local-D1 browser/API checks prove a restricted member receives `403` before provider work. |
| F03 | Organization-scoped mailbox CRUD | Shipped | [F03](specs/F03-mailboxes.md), [F47](specs/F47-mailbox-access-control.md) | `/mailboxes`, `/api/admin/mailboxes`, `/api/mailboxes*` | Organization admins provision and delete mailboxes; content/settings access requires explicit mailbox membership. Unrelated-mailbox isolation and immediate live revocation are production-verified. |
| F04 | Mail folders: inbox, sent, drafts, archive, spam, trash, starred | Shipped | [F04](specs/F04-mail-folders.md), [F72](specs/F72-mail-ui-state-synchronization.md) | dashboard folders, `/api/messages*` | Shared mutation invalidation keeps folder rows, filtered membership, detail controls, drafts, and navigation counts synchronized. Archive gained a read path on 2026-07-31: archiving previously wrote a status no view listed. |
| F05 | Full safe WYSIWYG compose, provider send, drafts, attachment UI | Shipped | [F05](specs/F05-compose-send.md), [F48](specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md), [F55](specs/F55-outbound-attachment-delivery.md), [F59](specs/F59-html-preserving-replies.md) | `/compose`, `/api/send`, `/api/drafts*`, `/api/v1/send` | History, links, semantic formatting, reactive/compact localized controls, safe colors/highlights, tables, CID inline images with alt text, sanitized HTML, derived text, reply boundaries, attachments, and shared drafts are locally verified. Production formatted HTML delivery/rendering is operator-confirmed; prior production evidence covers replies, drafts, attachments, and delivery state. |
| F06 | API keys | Shipped | [F06](specs/F06-api-keys.md), [F44](specs/F44-api-key-lifecycle.md) | `/api-keys`, `/api/api-keys`, `/api/v1/send` | Keys are created with a one-time secret, lifecycle metadata is visible, and owner-scoped permanent revocation is enforced during authentication. |
| F07 | Inbound routing rules and catch-all | Shipped | [F46](specs/F46-domain-catch-all-routing.md), [F77](specs/F77-security-hardening-routing-dependencies-imap.md) | `/routing`, `/api/routing-rules*` | Canonical per-domain rules and safe Cloudflare catch-all provisioning are production-verified; all routing APIs now enforce owner/admin authorization locally. |
| F08 | Webhooks | Shipped | Missing | `/webhooks`, `/api/webhooks*` | Payload/privacy behavior must be included in the production data-export audit. |
| F09 | Settings and profile | Shipped | [F09](specs/F09-settings.md) | `/settings`, `/api/settings/profile` | — |
| F10 | Seed/demo data | Shipped (development only) | Missing | `/api/seed` | Must not be exposed as a production capability. |
| F11 | Email agent: AI triage and smart inbox | Out of scope | — | — | — |
| F12 | Multi-user workspace: organizations, invites, roles, mailbox access | In Progress | [F12](specs/F12-multi-user-workspace.md), [F47](specs/F47-mailbox-access-control.md), [F48](specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md), [F49](specs/F49-identity-bound-organization-invitations.md), [F50](specs/F50-account-switch-cache-isolation.md), [F51](specs/F51-restricted-member-admin-navigation.md), [F83](specs/F83-access-and-security-center.md) | `/members`, `/api/org/members*`, `/api/org/invites/*`, mailbox-scoped APIs | Least-privilege mailbox ACLs, role-aware actions, draft privacy, revocation, shared-draft refresh, identity-bound invitation acceptance, explicit mailbox assignment, restricted invited-user login, cross-account browser-cache isolation, restricted-member admin navigation, automatic invitation delivery, safe fallback links, rotated-link resend, and retained lifecycle state are production-verified. |
| F51 | Restricted-member administration navigation | Shipped | [F51](specs/F51-restricted-member-admin-navigation.md) | mailbox selector, `(settings)/(org)` layout, `/api/auth/me` | Members fail closed without the admin selector entry and direct admin routes redirect before controls render; retained owner access and a no-hard-refresh member-to-owner switch are production-verified. |
| F53 | Theme token consistency (light + dark) | Shipped | [F53](specs/F53-theme-token-consistency.md) | `src/app/globals.css`, all pages/components | Semantic tokens, persistent System/Light/Dark selection, responsive repairs, and production usability validation are complete. |
| F68 | UI geometry consistency | Shipped | [F68](specs/F68-ui-geometry-consistency.md) | `src/components/ui/*`, `src/app/globals.css`, `(settings)`/`(dashboard)` layouts and pages | Extends [F53](specs/F53-theme-token-consistency.md) from colour to sizing, spacing, and layout. A `Select` primitive matched to `Input` replaces 19 hand-styled selects, buttons take one radius, each section frames content once instead of per page, and the modal scrim darkens in both themes rather than lightening in dark. Nine computed-style contracts in `tests/e2e-local/design-consistency.spec.ts` fail on divergence. Deployed 2026-08-01. |
| F69 | Navigation ergonomics | Shipped | [F69](specs/F69-navigation-ergonomics.md) | `(dashboard)`/`(settings)/(org)` layouts, `src/components/*nav*` | The sidebar collapses to a 64px icon rail, persisted across sessions and shared by both sections; labels move to `sr-only` so every destination keeps its accessible name. Phones get a bottom tab bar in the mail section, mounted by media query rather than hidden with `md:hidden` so no destination is duplicated in the accessibility tree at desktop. Tabs are chosen from capability-filtered links, so a viewer gets a full bar rather than a gap where Drafts would be. Deployed 2026-08-01. |
| F71 | Preference controls in the header | Shipped | [F71](specs/F71-preference-controls-in-header.md) | landing header, `AuthShell`, `(dashboard)`/`(settings)` headers, `language-switcher.tsx`, `theme-toggle.tsx` | Language and theme move from floating corners and the profile dropdown into the top header on every screen. The language control stays a native `<select>` laid transparently over an icon, so the platform picker, the full language names, and `selectOption` in the locale tests all survive; the trigger shows the locale code because flag emoji degrade to region letters on Windows. F53's z-index layering test is replaced by the stronger property that neither control is fixed-positioned. Deployed 2026-08-01. |
| F54 | Durable outbound delivery | Shipped | [F54](specs/F54-durable-outbound-delivery.md) | `/api/send`, `/api/v1/send`, `OUTBOUND_QUEUE`, Sent UI | Queue producer/consumer, idempotent claim, classified retries, DLQ finalization, and queued/failed UI are verified; migration `0012`, all queue consumers, and a one-attempt production queued-to-sent provider delivery are confirmed. |
| F55 | Outbound attachment delivery | Shipped | [F55](specs/F55-outbound-attachment-delivery.md) | compose, `/api/send`, `/api/v1/send`, R2, `OUTBOUND_QUEUE`, Cloudflare/Resend providers | Atomic acceptance, compensation, immutable metadata, exact-byte loading, and both provider adapters pass full verification; controlled production delivery preserved the filename, type, size, and exact R2 bytes and arrived at the external recipient. |
| F63 | R2 retention and orphan cleanup | In Progress | [F63](specs/F63-r2-retention-and-cleanup.md) | inbound consumer, `src/lib/r2-retention.ts`, `/api/admin/r2-retention`, Cron Trigger | Raw MIME is deleted once processing succeeds; unreferenced objects older than 7 days are sweepable. A content-free controlled production orphan is now aging through the unchanged policy: the young-object report scanned 16 and selected zero, with eligibility verification due after 2026-08-20 22:16:45 UTC. |
| F62 | External forwarding via Cloudflare Email Routing | Shipped | [F62](specs/F62-external-forwarding.md) | `worker.ts` `email()`, `/api/forwarding-destinations`, `/routing`, `/api/routing-rules` | Forwarding is performed by `message.forward()` at receive time and authorized by organization-owned, Cloudflare-verified destinations; rules naming an unowned or unverified destination are refused, and an undeliverable forward is rejected at SMTP rather than dropped. Migration `0018` is applied and a controlled message was forwarded to a verified external destination. |
| F61 | Operator-confirmed outbound delivery recovery | Shipped | [F61](specs/F61-outbound-delivery-recovery.md) | `/api/messages/[messageId]/retry`, Sent UI, `OUTBOUND_QUEUE` | A failed outbound job can be returned to the queue by a send-capable user after explicit confirmation. Recovery reuses the existing at-most-once claim, so duplicate enqueueing is impossible; an *ambiguous* provider failure can still duplicate, which is disclosed rather than prevented. Migration `0017` is applied and a controlled production recovery moved a genuinely failed message to `sent` with a provider message ID, one operator recovery, and no error. |
| F56 | Scheduled queue health monitoring | Shipped | [F56](specs/F56-queue-health-monitoring.md) | Worker Cron Trigger, Queue metrics, `/queue-health`, `/api/admin/queue-health` | Owner-only platform status, one-minute snapshots, dead-letter visibility, stale-job detection, and manual checks are locally and production-verified. Exact administrative pause state and automatic resume are deliberately excluded. |
| F57 | Inbound attachment ingestion | Shipped | [F57](specs/F57-inbound-attachment-ingestion.md) | PostalMime, inbound queue, R2, message attachment APIs/UI | Bounded exact-byte ingestion, atomic D1 metadata, R2 compensation, omission status, safe previews, and controlled production receipt/download are verified. |
| F13 | IMAP/SMTP bridge for email clients | In Progress | [F13](specs/F13-imap-smtp-bridge.md), [F52](specs/F52-imap-smtp-bridge-contract-repair.md), [F77](specs/F77-security-hardening-routing-dependencies-imap.md) | `/api/v1/session`, `/api/v1/messages*`, `/api/v1/send`, separate `imap-bridge` service | The mailbox-scoped API, persistent UID, truthful protocol, TLS, sender-binding, personal-key UI, automated contracts, and bounded command/idle/connection resources pass locally. Production bridge hosting, TLS, and controlled Thunderbird isolation/send validation remain required. |
| F14 | Starred messages | Shipped | [F72](specs/F72-mail-ui-state-synchronization.md) | `/starred`, `/api/messages/[id]/starred` | Star changes reconcile all cached folder variants and failed requests roll back optimistic row state. |
| F15 | Labels | Shipped | Missing | `/labels`, `/api/labels*` | — |
| F16 | Email aliases | Shipped | [F60](specs/F60-internal-alias-and-group-provisioning.md) | `/aliases`, `/api/aliases*`, Cloudflare Email Routing | Internal mailbox aliases now provision exact Worker rules and support same-organization cross-domain targets. Migration `0016` is deployed and controlled delivery is verified. External forwarding is now real and tracked separately as F62. |
| F17 | Attachment storage, download, and metadata in R2 | Shipped | [F55](specs/F55-outbound-attachment-delivery.md), [F57](specs/F57-inbound-attachment-ingestion.md) | `/api/attachments*`, `/api/messages/[id]/attachments`, inbound/outbound queues | Outbound delivery and inbound exact-byte extraction, storage, listing, preview, and download are production-verified. |
| F18 | Conversation/thread view | Shipped | [F58](specs/F58-rfc-aware-conversation-grouping.md), [F59](specs/F59-html-preserving-replies.md) | `/inbox/[id]`, `/api/messages/thread/[threadId]`, compose/drafts/send queues | RFC grouping and server-derived HTML-preserving replies are deployed and production-verified with a controlled three-message chain. Rich-text authoring and style/color support remain separate future work. |
| F19 | Message search | Shipped | Missing | `/api/messages?q=` | The production search plan uses the intended index and is included in the managed-D1 performance pass. |
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
| F74 | Authentication and registration hardening | Shipped | [F74](specs/F74-authentication-and-registration-hardening.md) | browser sessions, `/api/auth/*`, `/register`, durable limits | Cookie-only sessions, invitation-only post-bootstrap registration, D1-backed abuse limits, and active-organization role binding are implemented. Public self-registration is design-only and remains disabled. |
| F75 | Nested label folders | Shipped | [F75](specs/F75-nested-label-folders.md) | `/label/[id]`, `/api/labels*`, sidebar | One level of label nesting via `labels.parentId` (migration `0028`) plus browse destinations. Migrated-local-D1 evidence proves hierarchy/browse behavior and rejects another user's label even when its message is otherwise readable. |
| F76 | All-mailboxes scope | Shipped | [F76](specs/F76-all-mailboxes-scope.md) | mailbox selector, `/api/messages*` | The persisted client scope and unscoped server path aggregate every permitted mailbox. Migrated-local-D1 evidence uses two permitted and two forbidden mailboxes, proving both positive aggregation and row-level isolation; the selector also passes at 390px. |
| F79 | Remote recovery rehearsal | Shipped | [F79](specs/F79-remote-recovery-rehearsal.md) | recovery scripts and operator runbook | Production capture, isolated remote restore, schema/hashes, authenticated reads, mailbox isolation, rollback/return, exact cleanup, and production-fingerprint equality pass. The verified archive is EFS-encrypted/restricted with configurable 30-day retention through 2026-09-12; the Worker, R2 bucket/objects, and D1 are absent. |
| F80 | Operator lifecycle and readiness doctor | Shipped | [F80](specs/F80-operator-lifecycle.md) | `scripts/doctor.mjs`, operator CLI | Local checks pass 15/15 and the production run passes 26/26 with no warnings across deployment, bindings, D1/R2/Queues, migrations, secret presence, Email Routing/Sending, live Cron schedule, and complete public smoke. The live schedule is read from the Cloudflare REST API using the operator's existing Wrangler session, needing no additional credential. Stale six-check smoke and three-queue binding gates were corrected against the deployed contract. |
| F81 | Signed releases and deliberate promotion | Shipped | [F81](specs/F81-signed-releases.md) | release manifest/signature tooling, `scripts/release-keygen.mjs`, `scripts/release-promote.mjs` | Offline key `bstag-2026` is pinned, and release `0.1.0` for clean commit `04415c1` and exact schema `0039` passes detached-signature and artifact verification. Signed Worker version `27717f91-d867-4b28-8018-2a503d2fd0d4` passed 8/8 immutable-preview checks before receiving 100% traffic; post-promotion doctor passes 26/26 with no pending migrations. Fresh verification was recorded as production release evidence `ope_DvF4qhsCPHY_6KPYWiCtv` through explicitly authorized Wrangler D1 operator access. |
| F82 | Read-only Operations Center | In Progress | [F82](specs/F82-operations-center.md) | `/operations`, `/api/admin/operations`, `/api/admin/operations/evidence*` | The deployed overview and organization-scoped ledger are verified. Explicit authenticated adapters derive public-smoke, received mail-flow, signed-release, and recovery-archive results; none accepts arbitrary category/count/outcome input. Current production public smoke passes 8/8 and is recorded as evidence `ope_tBkMV09clCIz0SBeJ2Ei8`; signed-release evidence is also present. Recovery evidence re-hashes the D1 export and every manifest object and states archive integrity only. Restore-rehearsal attestation, independent delivery attestation, and additional integrity observations remain later slices. |
| F83 | Access and security center | Shipped | [F83](specs/F83-access-and-security-center.md) | `/members`, `/api/admin/access-overview`, `/api/admin/sessions*`, `/api/admin/security-events`, `/api/admin/mailbox-grants`, `/api/org/invites/*`, `/api/auth/reconfirm` | The access matrix separates organization role from explicit mailbox capabilities. Owner-only sessions, password-confirmed revocation, content-free security history, audited additive bulk grants, automatic invitation email, rotated-link resend with durable cooldown, expiry, provider-acceptance state, and retained acceptance history are production-proven. |
| F84 | Production performance evidence | Shipped | [F84](specs/F84-production-performance-evidence.md) | `scripts/performance-evidence.mjs`, `scripts/performance-d1.mjs`, production HTTP/D1/Queues | Fixed content-free HTTP and managed-D1 commands pass 30 focused tests. Production D1 ran eight read-only statements in 2.485 ms with intended hot indexes and zero writes; six authenticated HTTP paths pass fixed p95 targets (358–718 ms); an approved five-message Queue batch reached five unique `sent` states in 95.947 seconds and drained with no backlog, stale jobs, or dead letters. |
| F85 | Unified settings shell | Shipped | [F85](specs/F85-unified-settings-shell.md) | `src/app/(settings)/`, `src/components/settings/settings-nav*` | Personal settings and organization administration render inside one shell: one header, one compact grouped role-filtered sidebar, one content-width contract, entered from the profile menu. All URLs and server authorization are unchanged; organization routes carry their guard in the nested `(org)` layout. |
| F86 | Desktop split view and conversation rows | Shipped | [F86](specs/F86-desktop-split-view.md) | folder lists, message detail routes, `/api/messages` | Wide screens retain the list beside a URL-synchronized, resizable conversation panel; direct links and mobile remain full-page. Avatar/thread metadata uses one bounded aggregate, with real-D1 proof that inaccessible same-thread mail is excluded. |
| F87 | OAuth-protected MCP integration | Shipped | [F87](specs/F87-mcp-oauth.md) | `/mcp`, `/oauth/*`, `/settings/mcp`, `OAUTH_KV`, D1/Queues | Read-only and separately consented mail-action profiles, exact session/org/mailbox authorization, secret-free lifecycle/audit, bounded tools, and durable send idempotency are deployed. Public production checks pass; isolated staging action evidence passes 11/11; authenticated production read-only evidence passes 9/9; and the temporary production connection was revoked and verified in Settings. |
| F88 | Privacy-preserving push notifications | Shipped | [F88](specs/F88-push-notifications.md) | `/api/push/*`, `/notifications/*`, `/settings/notifications`, service worker, D1/Queues | Explicit per-device enrollment, mailbox preferences default off, exact-session and live mailbox authorization, opaque content-free payloads, isolated durable queues/outbox, bounded retry/cleanup, lifecycle audit, and accessible Settings UI are locally verified and deployed. Separate staging and production Chrome/provider proofs cover zero-default opt-in, first-attempt delivery, authorized and access-revoked resolution, recent-auth revocation, unsubscribe, and zero post-revoke delivery. Production 8/8 smoke passes. |
| F89 | External mail accounts and unified mailbox | Planned | [F89](specs/F89-external-mail-accounts.md) | `/settings/external-accounts`, `/api/external-accounts*`, `EXTERNAL_SYNC_QUEUE` | OAuth-first Google/Microsoft aggregation is implemented with bounded import, provider sending, lifecycle controls, and prospective retained originals. It remains Planned until controlled provider and deployment evidence is recorded; generic IMAP/SMTP, full-history verified backup, and two-way synchronization are later stages. |
| F90 | Repository-wide CRAP quality gate | In Progress | [F90](specs/F90-crap-quality-gate.md) | Vitest coverage, npm verification, GitHub CI | Every executable TypeScript/TSX function must receive a CRAP score no higher than 30; all-source scoring and remediation are in progress. |
| F91 | Picket UI rebrand | Shipped | [F91](specs/F91-picket-ui-rebrand.md) | application metadata, UI copy, PWA assets, transactional copy, client protocol greetings | Presentation-only; all lowercase Lumimail compatibility and infrastructure identifiers remain unchanged. |
| F92 | Mantle presentation layer | Planned | [F92](specs/F92-mantle-presentation-layer.md) | brand source archive, normalized sigils, semantic theme tokens, typography, PWA assets, application shells | Staged visual-system adoption; behavior, data, authorization, routes, and infrastructure remain unchanged. |

Implementation notes for shipped features live in `docs/implementation/`, but those
notes are not substitutes for feature specifications and executable tests.
The original F01–F35 audit is preserved in
[FEATURE_VALIDATION.md](FEATURE_VALIDATION.md); it is a dated snapshot. Current
status is maintained in this registry and in each linked specification.

## What is operational now

- Registration, login, identity-bound invitation acceptance, password recovery, sessions, and organizations.
- Provider-backed domain onboarding, exact/catch-all routing, internal aliases,
  bounded mailbox groups, and verified external forwarding.
- Capability-scoped mailbox access with shared-mailbox isolation, role-aware
  actions, immediate revocation, and restricted-member navigation.
- Inbound and durable outbound queues, visible delivery state, classified retry,
  dead-letter monitoring, and operator-confirmed recovery.
- Folders, RFC-aware conversations, metadata search, labels, filters, contacts,
  drafts, safe vacation replies, bulk actions, and safe formatted composition
  with meaningful plain-text alternatives and HTML-preserving reply quotations.
- Bounded inbound attachment extraction and outbound attachment delivery through
  R2, including scoped downloads and safe image/PDF previews.
- Theme selection, responsive layouts, and—on the current local branch—consistent
  geometry, a collapsible sidebar, and a mobile tab bar.

These capabilities support controlled production use. The unchecked gates below
still prevent a general production-ready claim, and the separately deployed
IMAP/SMTP bridge remains in progress.

## Remaining operator and external-environment checks

Deterministic application contracts may close through local equivalence when the
exact production code, migrations, schema, and binding shapes are exercised. The
remaining checks below depend on infrastructure, providers, recipient clients, or
the exact deployed artifact and therefore still require the operator.

| Priority | Required outcome | Why it blocks the MVP | Tracking |
|----------|------------------|-----------------------|----------|
| P1 | Host and validate the IMAP/SMTP bridge | Local protocol and API contracts pass; a trusted-TLS production host and controlled client isolation/send pass remain. | [R-23](REMEDIATION_PLAN.md#phase-3--multi-user-authorization) |

## Production-readiness gates

All of these must be checked before a general production launch:

- [x] Hostile HTML, links, and inline content are rendered without executable content or credential leakage.
- [x] A fresh D1 database and an upgraded production-like database both pass automated schema verification.
- [x] Exact-address and catch-all inbound delivery pass across at least two domains, including precedence and no-match cases.
- [x] Formatted outbound mail and replies reach controlled recipients with equivalent HTML and plain-text content; drafts and attachments preserve expected content and delivery/failure state.
- [x] Retried queue events cannot send duplicate mail, and terminal failures are recoverable.
- [x] Restricted users cannot enumerate, read, search, download from, or send as unauthorized mailboxes.
- [x] Restricted members cannot view or mutate organization domain configuration through UI or direct API calls.
- [x] Two or more users can share one mailbox without receiving access to unrelated mailboxes.
- [x] Password recovery works end to end in production without exposing reset tokens.
- [ ] Backup, restore, retention, cleanup, and rollback procedures have been exercised.
- [x] Logs, webhooks, and third-party providers have a documented data-egress inventory with no unexpected message or credential export.
- [x] Multiple-domain load and D1 query plans meet documented performance targets.
- [x] `npm run verify`, the required E2E suite, deployment smoke tests, and traced mail-flow tests pass.

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
| `npm run verify` | Passing 2026-08-13 — 2,117 application tests across 243 files at 100% configured coverage plus 21 bridge tests; lint has zero errors. |
| Required E2E suite | Passing 2026-08-11 — all 71 mocked Chromium scenarios and all 52 migrated-local-D1 scenarios pass. F73 provides bounded cross-platform server teardown and keeps both suites off remote resources. |
| Deployment smoke tests | Passed 2026-08-13 against `https://mail.henriksen.dev`: landing, login, and manifest returned `200`; anonymous session, mailbox, and admin-mailbox APIs returned `401`. The Queue proof's first post-batch attempt had one transport-level `/` fetch miss (5/6), and the immediate clean retry passed 6/6. The command is regression-tested for success and fail-closed exit behavior. Re-run after each deployment. |
| Traced mail-flow tests | Passed in production 2026-08-11. The stored Gmail RFC ID matched the reply's `in_reply_to`, `references_header`, and immutable queue headers; inbound and outbound rows shared one thread; message/job were `sent` after one attempt with no error; Cloudflare returned a provider RFC Message-ID; the operator confirmed exactly one reply arrived externally. |

All four clauses pass. The deployment smoke and controlled mail trace both ran
against production on 2026-08-11.

Terminal failure recoverability was the stale exception in the prior
reconciliation. F61/R-34 now provides explicit operator recovery and a controlled
production failure-to-sent pass; the corresponding gate above is checked.

### Recovery clause reconciliation 2026-08-13

F79 closes backup, remote restore, application/isolation verification, Worker rollback/return,
disposable-resource cleanup, production-fingerprint equality, encrypted archive handling, and a
configurable 30-day destruction policy. Independent inventory proves the recovery Worker, 15-object
R2 bucket, and D1 are absent; production smoke passes 6/6. The combined gate remains unchecked only
because F63 still requires one genuine eligible orphan to be swept in production, proving the live
retention deletion path rather than only its deterministic tests and enabled schedule.

## Specification coverage debt

The registry currently has shipped or partially shipped behaviors without numbered
specifications: F08, F10, and F14–F32. Those features need specs defining their
actual security, tenant-isolation, error, and test contracts before they can be
considered fully documented.

Additional registry hygiene required:

- Resolve the duplicate F02 identifier currently used by the unrelated GitHub CI specification.
- Reconcile stale statuses in F01, F12, F13, and F34 specifications with verified behavior.
- Ensure each future status change records test and deployment evidence rather than relying on route existence.

### Reconciliation 2026-07-28

- F02 now uses the established organization-admin guard across list, detail,
  DNS, create, sending-reconciliation, and removal endpoints. The UI already
  rejected restricted members. Thirty focused domain tests, full verification,
  and the three restricted-admin browser scenarios pass locally; production
  deployment evidence remains an MVP gate.
- F05 safe WYSIWYG authoring is implemented for the MVP. It reuses
  Tiptap for semantic and allowlisted presentation formatting, tables, and
  uploaded CID images; sends safe HTML plus derived plain text; and keeps raw
  reply-source HTML server-owned. Production formatted HTML delivery/rendering
  was operator-confirmed on 2026-08-11; deterministic tests cover the derived
  text alternative and provider snapshot.

## Post-MVP enhancements

| Feature | Notes |
|---------|-------|
| Advanced composer extensions | Arbitrary HTML/source editing, arbitrary CSS, font-family/size controls, remote images, embedded audio/video, templates, and scheduled send remain out of scope. |
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
- **Migrations:** hand-written, append-only numbered SQL in `drizzle/migrations/`,
  verified against the Drizzle schema by the F42 parity tests. The
  `drizzle-kit generate` workflow was removed 2026-07-30 (its metadata had been
  stale since migration `0006` and would have produced wrong output).
- **Tenant isolation:** every organization- and mailbox-scoped operation must enforce authorization server-side and have negative tests.
