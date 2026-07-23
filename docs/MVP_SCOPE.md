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
| F03 | Organization-scoped mailbox CRUD | Deployed — Validation Pending | [F03](specs/F03-mailboxes.md), [F47](specs/F47-mailbox-access-control.md) | `/mailboxes`, `/api/admin/mailboxes`, `/api/mailboxes*` | Organization admins provision and delete mailboxes; content/settings access requires explicit mailbox membership. Controlled multi-user production validation remains. |
| F04 | Mail folders: inbox, sent, drafts, spam, trash, starred | Shipped | [F04](specs/F04-mail-folders.md) | dashboard folders, `/api/messages*` | — |
| F05 | Plain-text compose, provider send, drafts, attachment UI | Partially Shipped | [F05](specs/F05-compose-send.md), [F48](specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md) | `/compose`, `/api/send`, `/api/drafts*`, `/api/v1/send` | Shared mailbox drafts are capability-scoped and refresh on a bounded interval; attachments are uploaded after provider send and are not proven to be included in outbound MIME. |
| F06 | API keys | Shipped | [F06](specs/F06-api-keys.md), [F44](specs/F44-api-key-lifecycle.md) | `/api-keys`, `/api/api-keys`, `/api/v1/send` | Keys are created with a one-time secret, lifecycle metadata is visible, and owner-scoped permanent revocation is enforced during authentication. |
| F07 | Inbound routing rules and catch-all | Shipped | [F46](specs/F46-domain-catch-all-routing.md) | `/routing`, `/api/routing-rules*` | Canonical per-domain rules, safe Cloudflare catch-all provisioning, and named-recipient precedence are deployed and production-verified with controlled exact/catch-all delivery across LucidKith and Henriksen. |
| F08 | Webhooks | Shipped | Missing | `/webhooks`, `/api/webhooks*` | Payload/privacy behavior must be included in the production data-export audit. |
| F09 | Settings and profile | Shipped | [F09](specs/F09-settings.md) | `/settings`, `/api/settings/profile` | — |
| F10 | Seed/demo data | Shipped (development only) | Missing | `/api/seed` | Must not be exposed as a production capability. |
| F11 | Email agent: AI triage and smart inbox | Out of scope | — | — | — |
| F12 | Multi-user workspace: organizations, invites, roles, mailbox access | In Progress | [F12](specs/F12-multi-user-workspace.md), [F47](specs/F47-mailbox-access-control.md), [F48](specs/F48-role-aware-mail-actions-and-shared-draft-refresh.md) | `/members`, `/api/org/members*`, mailbox-scoped APIs | Least-privilege mailbox ACLs, role-aware mail actions, and draft privacy are deployed pending controlled live validation. Invites are not emailed and registration does not enforce the invited address. |
| F13 | IMAP/SMTP bridge for email clients | Blocked | [F13](specs/F13-imap-smtp-bridge.md) | separate `imap-bridge` service | The bridge uses API keys against session-only endpoints and cannot authenticate/read mail as documented; SMTP payload shape is also incompatible. |
| F14 | Starred messages | Shipped | Missing | `/starred`, `/api/messages/[id]/starred` | — |
| F15 | Labels | Shipped | Missing | `/labels`, `/api/labels*` | — |
| F16 | Email aliases | Partially Shipped | Missing | `/aliases`, `/api/aliases*` | Internal delivery exists; external forwarding is not implemented beyond logging. |
| F17 | Attachment storage, download, and metadata in R2 | Partially Shipped | Missing | `/api/attachments*`, `/api/messages/[id]/attachments` | Manual upload/download works; inbound MIME attachments are never extracted and outbound files are not transmitted. |
| F18 | Conversation/thread view | Partially Shipped | Missing | `/inbox/[id]`, `/api/messages/thread/[threadId]` | UI/query exist, but References/In-Reply-To are not parsed and ordinary conversations do not group reliably. |
| F19 | Message search | Shipped | Missing | `/api/messages?q=` | Multiple-domain performance remains unmeasured. |
| F20 | Auto-captured contacts | Shipped | Missing | inbound/outbound hooks | — |
| F21 | Password reset | Shipped | [F43](specs/F43-password-recovery.md) | `/forgot-password`, `/reset-password`, `/api/auth/forgot-password`, `/api/auth/reset-password` | Non-enumerating recovery, one-time token claiming, recovery-email delivery, session revocation, and production login verified. |
| F22 | Contacts UI | Shipped | Missing | `/contacts`, `/api/contacts` | — |
| F23 | Label filtering in message lists | Shipped | Missing | label chips, `/api/messages?labelId=` | — |
| F24 | Email filters/rules | Shipped | Missing | `/filters`, `/api/filters*` | — |
| F25 | Vacation responder | Partially Shipped | Missing | `/settings`, `/api/vacation` | Automatic replies work, but loop suppression and per-sender frequency controls are incomplete. |
| F26 | Reply and user-initiated forward composition | Shipped | Missing | `/inbox/[id]`, `/compose` | This is distinct from automatic external alias forwarding in F16/F30. |
| F27 | Inline attachment list | Partially Shipped | Missing | `/inbox/[id]`, attachment APIs | The list works for stored rows, but inbound messages never ingest their MIME attachments. |
| F28 | Password change for authenticated users | Shipped | Missing | `/settings`, `/api/auth/change-password` | — |
| F29 | Bulk actions and pagination | Shipped | Missing | message-list toolbar, `/api/messages/bulk` | — |
| F30 | Group aliases and fan-out delivery | In Progress | Missing | `/aliases`, inbound routing | Expansion logic exists, but there is no UI/API to manage group members, no Cloudflare alias route provisioning, and external delivery is absent. |
| F31 | Inline image/PDF preview | Partially Shipped | Missing | `/inbox/[id]`, `/api/attachments/[id]?disposition=inline` | Preview works for stored rows, but received attachments are not ingested; safe rendering also depends on F34. |
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
| P1 | Include attachments in outbound delivery | Uploading after provider send stores a file but does not establish that recipients received it. | [R-20](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) |
| P1 | Complete password recovery UI and email delivery | A production user who loses a password has no usable recovery flow. | [R-21](REMEDIATION_PLAN.md#phase-1--data-integrity-and-api-contracts) — completed 2026-07-22 |
| P1 | Implement forwarding or remove it from the product contract | External alias/group targets currently log rather than receive messages. | [R-09](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) |
| P1 | Queue outbound mail with idempotent retries and failure visibility | Synchronous provider calls lack durable delivery and duplicate protection. | [R-10](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) |
| P1 | Establish intentional R2 retention/cleanup | Failed or unroutable inbound messages can leave orphaned raw objects. | [R-11](REMEDIATION_PLAN.md#phase-2--sending-and-routing-correctness) |
| P2 | Repair localization and implement a complete theme contract | Raw keys, invalid ICU text, and fixed light colors make the interface inconsistent. | [R-14–R-16](REMEDIATION_PLAN.md#phase-4--theme-localization-and-interface-consistency) |
| P2 | Verify multi-domain scale, recovery, rollback, and data export | Operational behavior and privacy must be demonstrated, not inferred from code. | [R-17/R-18](REMEDIATION_PLAN.md#phase-5--operational-hardening) |

## Production-readiness gates

All of these must be checked before a general production launch:

- [ ] Hostile HTML, links, and inline content are rendered without executable content or credential leakage.
- [ ] A fresh D1 database and an upgraded production-like database both pass automated schema verification.
- [x] Exact-address and catch-all inbound delivery pass across at least two domains, including precedence and no-match cases.
- [ ] Outbound, reply, drafts, and attachments reach controlled recipients with observable delivery/failure state.
- [ ] Retried queue events cannot send duplicate mail, and terminal failures are recoverable.
- [ ] Restricted users cannot enumerate, read, search, download from, or send as unauthorized mailboxes.
- [ ] Two or more users can share one mailbox without receiving access to unrelated mailboxes.
- [x] Password recovery works end to end in production without exposing reset tokens.
- [ ] Backup, restore, retention, cleanup, and rollback procedures have been exercised.
- [ ] Logs, webhooks, and third-party providers have a documented data-egress inventory with no unexpected message or credential export.
- [ ] Multiple-domain load and D1 query plans meet documented performance targets.
- [ ] `npm run verify`, the required E2E suite, deployment smoke tests, and traced mail-flow tests pass.

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
