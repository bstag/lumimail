# HQBase comparison and Lumimail adoption plan

Status: planning draft
Date: 2026-08-12
Reference implementation: [HQBase](https://github.com/HQBase/hqbase), reviewed at `v1.0.1`

## Purpose

This document compares HQBase with the current Lumimail implementation and turns the useful ideas
into bounded Lumimail work. It is not a parity commitment. Lumimail should preserve its stronger
multi-tenant authorization and durable mail pipeline while adopting the operational and workflow
ideas that reduce installation, recovery, and day-to-day administration risk.

The only item in this plan that blocks the existing MVP gate is the remote backup/restore rehearsal.
The remaining work is ordered so it can improve the product without moving the MVP finish line.

## Executive comparison

| Area | Lumimail today | HQBase today | Direction |
|------|----------------|--------------|-----------|
| Deployment model | Multi-organization application in one deployment | One workspace per deployment | Keep Lumimail's model |
| Outbound delivery | Durable queue, idempotent claim, retries, DLQ, recovery | Provider call before D1 persistence | Keep Lumimail's pipeline |
| Inbound routing | Exact, catch-all, aliases, groups, forwarding, verified production paths | Exact addresses plus a catch-all policy surface that is not fully applied by inbound storage | Keep Lumimail's routing |
| Releases | Source deployment and documented smoke/verification commands | Signed release manifest, immutable archive, digest verification, staged upgrade rehearsal | Adopt the release provenance pattern |
| Recovery | Local D1/R2 recovery is implemented; remote rehearsal remains open | D1 bookmark and Worker rollback are automated; R2 is inventoried but not backed up | Build a complete Lumimail recovery workflow |
| Operator tools | Scripts and admin pages are distributed by concern | Install, doctor, backup, restore, update, and destroy workflows are presented as one lifecycle | Add a cohesive operator surface |
| AI integration | API keys and mailbox-scoped APIs | OAuth-protected MCP with read-only and mail-action profiles | Add after MVP as a separately consented surface |
| Client access | Web/PWA plus an in-progress IMAP/SMTP bridge | Web/PWA plus remote MCP | Keep the bridge; add MCP independently |
| Collaboration | Organizations, roles, mailbox capabilities, identity-bound invites | Workspace roles plus read/agent/manager mailbox access | Improve Lumimail's explanation and UI, not its enforcement model |
| Mail productivity | Labels, nested labels, filters, contacts, groups, vacation, bulk actions, provider recovery | Leaner conversation client with push, audit, retention, session and update controls | Keep breadth; selectively adopt the stronger workflows |
| Localization | Ten languages, RTL, locale-aware UI | English-only | Keep Lumimail's localization contract |

## UI and interaction comparison

### HQBase strengths

- Desktop is a true three-pane client: navigation, conversation list, and the open conversation are
  visible together. Panel widths are resizable and remembered.
- Mobile is inbox-first and uses a compact navigation pattern instead of reproducing the desktop
  layout.
- Conversations use avatars, participant identity, message count, short previews, and inline thread
  expansion to make shared-inbox scanning fast.
- Workspace administration is consolidated under Settings. Access, domains, sessions, audits,
  operations, notifications, and updates feel like parts of one product lifecycle.
- The access-control UI explicitly separates workspace role from mailbox permission and explains
  `Read`, `Agent`, and `Manager` as a capability matrix.
- MCP connection is a small user workflow: choose read-only or mail actions, copy the endpoint,
  authenticate, and consent.
- Update readiness is visible inside the app without forcing a reload.

### Lumimail strengths

- The navigation exposes substantially more mature mail workflows: labels, nested labels, contacts,
  filters, spam, aliases, routing, webhooks, API keys, and queue health.
- All-mailboxes scope is independent from the active sending identity, avoiding accidental sender
  changes while browsing aggregated mail.
- Folder rows expose delivery state and operator recovery, not merely message content.
- Compose supports a broader safe rich-text contract, CID images, attachments, drafts, and
  HTML-preserving replies.
- Admin and member navigation are capability-filtered, production-tested, localized, RTL-aware,
  collapsible on desktop, and represented by a dedicated mobile tab bar.
- The UI represents a genuinely multi-organization system rather than one workspace deployed per
  customer.

### Recommended UI changes

1. Add an optional desktop split view while retaining the existing route-based full-message page.
   Selecting a row should update the URL and render the conversation in a resizable right panel;
   direct links and small screens should continue to use the full page.
2. Create one Settings shell with categories for personal settings, mailbox settings, organization,
   security, operations, integrations, and updates. Existing authorization boundaries and routes
   remain server-enforced even if navigation is visually consolidated.
3. Replace role-only member editing with an access explanation and matrix showing organization role,
   mailbox capability, invitation state, and effective access.
4. Add a conversation-list presentation using participant avatar/initials, unread state, thread
   count, mailbox identity, delivery state, and preview without duplicating accessible content.
5. Add an Operations center for release version, binding readiness, queue/DLQ state, latest backup,
   restore rehearsal, retention, integrity checks, and smoke-test evidence.
6. Add session/device management, audit history, invitation delivery/resend state, and push
   notification preferences as separate bounded features.

The split view is a desktop enhancement, not a rewrite. The current list, detail, query keys,
authorization, and mobile routes remain the source of truth.

## Feature inventory

### Shared capabilities

- Multiple domains and shared mailboxes
- Mailbox-scoped permissions
- Conversation/thread display and search
- Drafts, attachments, send, reply, and forward
- PWA/offline shell
- Domain onboarding and Cloudflare Email Sending/Routing
- Retention jobs, diagnostics, and administrative roles

### Useful HQBase capabilities Lumimail does not currently expose

| Capability | Proposed treatment | MVP impact |
|------------|--------------------|------------|
| Signed release manifests and immutable artifacts | Adopt for published releases | No; post-MVP operational hardening |
| Upgrade rehearsal against the previous stable release | Adopt in release CI | No |
| Unified install/doctor/backup/restore/update tooling | Adopt incrementally | Restore rehearsal closes an existing MVP gate |
| In-app update availability and explicit reload | Adopt after signed releases exist | No |
| OAuth-protected remote MCP | Add with read-only and mail-action profiles | No; post-MVP |
| Push notifications | Add with mailbox-scoped payload minimization | No; post-MVP |
| Audit-history UI | Expose existing/new content-free audit events | No |
| Session/device management | Add revoke-one and revoke-others workflows | No |
| Invitation email, resend, and delivery state | Add to the existing identity-bound invitation flow | No |
| Per-mailbox retention UI | Extend the current R2 retention work carefully | No |
| Per-sender remote-image trust | Consider only after its privacy contract is specified | No |
| Three-pane resizable client | Add as an optional desktop presentation | No |

### Lumimail capabilities that must not regress

- Multi-tenant organization isolation and negative authorization tests
- Durable outbound acceptance, retry classification, DLQ handling, and operator recovery
- Provider-backed exact/catch-all routing, aliases, internal groups, and verified forwarding
- Complete D1 plus R2 backup semantics with hashes and referential-integrity checks
- API keys, webhooks, IMAP/SMTP bridge, labels, filters, contacts, vacation responder, and bulk actions
- Localized and RTL layouts
- Safe rich composition, hostile-HTML handling, and attachment preview/download controls
- Production evidence for threading, one-attempt delivery, recovery, and restricted-user isolation

## Layered delivery model

Work moves upward only after the lower layer has a stable contract. A later UI must consume the
same evidence and authorization functions as the CLI/API below it; it must not become a second
implementation of recovery, access control, or deployment logic.

| Layer | Outcome | Features | Depends on | MVP status |
|-------|---------|----------|------------|------------|
| 1. Recovery foundation | A complete production-shaped backup can be restored and verified in isolated remote resources | F79 | Existing F78 local-equivalence helpers and F63 retention rules | Required to close the recovery gate |
| 2. Operator lifecycle | Deployments are diagnosable, attributable, reproducible, and reversible | F80, F81 | Layer 1 manifests and recovery evidence | Post-MVP hardening |
| 3. Administrative product surface | Owners can understand health, access, sessions, audit, and recovery from one UI | F82, F83 | Layers 1–2 read models and existing authorization | Post-MVP |
| 4. Integration surface | AI clients receive narrowly consented mailbox access through OAuth/MCP | F84 | Stable audit, session, capability, and durable-send contracts | Post-MVP |
| 5. Mail-client experience | Desktop split view and private push notifications improve daily use | F85, F86 | Stable message/query state plus security-center device controls | Post-MVP |

### Promotion rules between layers

- Core behavior is implemented as a tested library or script before an API or UI calls it.
- Read-only inspection ships before destructive or externally mutating controls.
- Mutations require exact target resolution, confirmation, compensation where possible, and an
  audit event.
- Application roles never implicitly gain Cloudflare deployment authority.
- Every organization/mailbox surface includes positive access and cross-tenant negative tests.
- Local equivalence closes deterministic behavior; managed-service mechanics and external delivery
  retain explicit staging or operator evidence.
- A later layer may be postponed without reopening a completed lower-layer gate.

## Layer 1 working breakdown — remote recovery foundation

Layer 1 is the active planning layer. It extends the existing local tools rather than replacing
them:

- `scripts/r2-backup.mjs` already extracts D1-referenced keys, captures exact bytes, hashes them,
  verifies an offline manifest, and defaults restore to local storage.
- `scripts/restore-local.mjs` already restores a D1 export and verifies foreign keys and schema.
- F78 already proves missing-object and checksum failures locally.
- F63 defines which R2 objects are intentionally retained; a recovery manifest must not silently
  reinterpret that policy.

### Layer 1 decisions

- The MVP rehearsal target is disposable resources in the same Cloudflare account. This proves the
  remote D1/R2/Worker mechanics without introducing cross-account credentials into the critical
  path. Cross-account or independent-provider backup is a later resilience decision.
- Production access is read-only during backup. Restore commands target explicit staging resource
  IDs and refuse production IDs, non-empty targets, or any Worker/domain receiving production mail.
- The restore uses a D1 export plus exact R2 objects as the portable backup. A Time Travel bookmark
  is recorded as a short-window production recovery aid, not treated as the portable backup.
- The first pass is operator CLI/runbook only. No web endpoint can start a backup or restore in
  Layer 1.
- Backup artifacts contain mail data and are sensitive. They stay outside the repository, are not
  uploaded as ordinary CI artifacts, and must use encrypted operator-controlled storage.
- The proof restores to staging and reads representative messages/attachments there. It never
  overwrites production for rehearsal.

### Work packets

#### L1.1 — specification and target guard — complete 2026-08-12

Implemented in `docs/specs/F79-remote-recovery-rehearsal.md`,
`scripts/recovery-target-guard.mjs`, and
`tests/unit/scripts/recovery-target-guard.test.ts`.

- Define source/target resource identity, forbidden targets, backup format, failure states, cleanup,
  evidence, and recovery point objective boundaries.
- Add a target-guard module that accepts resolved account, D1, R2, Worker, Queue, and Email Routing
  inventory and refuses broad, ambiguous, production, routed, or non-empty targets.
- Tests must prove production IDs, name-only guesses, an active mail route, and partially populated
  targets all fail before writes.

Output: an in-progress F79 spec, a pure guard with no provider calls or writes, and ten passing unit
contracts. Inventory resolution begins in L1.2/L1.3; the guard must run again immediately before the
first later remote write.

#### L1.2 — versioned recovery manifest — complete 2026-08-12

- Promote the current R2-only manifest into `lumimail-recovery-v1`.
- Record source account/resource IDs, backup timestamp, application commit/artifact identity, Worker
  version, compatibility date, migration/schema version, D1 export SHA-256, D1 bookmark, and each R2
  object's key, size, ETag when available, and SHA-256.
- Canonicalize the manifest so verification is deterministic and future signing can be added without
  changing the backup format.
- Never include credentials, session cookies, provider tokens, or Cloudflare OAuth grants.

Output: `scripts/recovery-manifest.mjs` provides strict parsing, normalization, canonical bytes, and
offline D1/R2 verification. Ten tests cover corrupt/missing files, malformed/legacy/foreign-product
manifests, unsafe or duplicate keys, normalization, immutability, and deterministic serialization.
The legacy R2-only producer remains unchanged until L1.3 can supply the complete source inventory.

#### L1.3 — production read-only capture

- Export production D1 and hash the completed export.
- Record the current Time Travel bookmark and active Worker version.
- Enumerate the R2 keys referenced by that exact export and download their exact bytes.
- Also inventory unreferenced retained objects separately; they are diagnostics, not automatically
  injected into the restored database.
- Verify the backup completely before reporting success.

Output: one self-contained encrypted backup directory plus a content-free capture report.

Implementation status 2026-08-12: the read-only capture command and five fail-closed orchestration
contracts are complete. The actual production capture and at-rest encryption/storage policy remain
before this packet is marked complete.

#### L1.4 — isolated remote restore

- Create or select explicitly named disposable D1, R2, Worker, Queue, and configuration resources.
- Verify they are outside production routing and empty.
- Import D1, restore exact R2 keys, apply only restore-safe configuration, and deploy the matching
  application artifact/Worker version.
- Keep Email Routing, Email Sending, cron, outbound queue consumption, webhooks, vacation responses,
  and external forwarding disabled until verification finishes.

Output: isolated staging installation that cannot emit or receive production mail.

#### L1.5 — integrity and application verification

- Verify manifest hashes, D1 foreign keys, exact migration parity, table/row counts, D1-to-R2
  referencedness, R2-to-D1 orphan reporting, and representative attachment byte hashes.
- Run authenticated smoke checks against the restored site with a staging-only operator identity;
  do not reuse a production password or session.
- Open representative folders, a threaded conversation, safe HTML, and attachment download paths.
- Prove restricted-user and unrelated-mailbox denial against restored production-shaped data.

Output: machine-readable verification report and human-readable evidence checklist.

#### L1.6 — Worker rollback drill

- Record current and previous Worker version IDs.
- Prove code rollback independently from D1 restore, because Worker versions do not version D1 or R2.
- Smoke the rolled-back version against compatible staging data, then return staging to the intended
  version.
- Document when schema compatibility makes code-only rollback unsafe.

Output: rollback transcript with version IDs and smoke results.

#### L1.7 — cleanup and gate closure

- Preserve the recovery manifest and verification report while removing only the explicitly recorded
  disposable resources.
- Verify production resource IDs and routing were unchanged.
- Update F79, `docs/OPERATIONS.md`, `docs/MVP_SCOPE.md`, and the remediation evidence only after the
  remote rehearsal passes.

Output: completed recovery-gate evidence and a repeatable operator runbook.

### What can be automated versus operator-proven

| Evidence | Automated locally/CI | Requires disposable Cloudflare resources | Requires production read |
|----------|-----------------------|------------------------------------------|--------------------------|
| Manifest parsing, hashing, corruption detection | Yes | No | No |
| Target guard and forbidden-resource checks | Yes, with fixtures | Final identity check | No |
| D1/R2 restore integrity logic | Yes | Remote mechanics | No |
| Worker rollback command and smoke logic | Yes, mocked/dry-run | Actual version activation | No |
| Production-shaped data capture | No | No | Yes, read-only |
| Staging restore, binding swap, and authenticated read | No | Yes | No |
| Proof production routing was unchanged | Scripted comparison | Yes | Read-only before/after inventory |

### Layer 1 exit checklist

- [ ] F79 specification is final and matches the implemented commands.
- [ ] Production capture is read-only and the backup verifies before restore.
- [ ] Every D1-referenced R2 object is present with matching exact-byte checksum.
- [ ] Target guards reject production and routed/non-empty resources before mutation.
- [ ] Isolated remote D1 and R2 restore succeeds.
- [ ] Restored schema, references, rows, objects, and representative app reads verify.
- [ ] Restricted-user and mailbox-isolation checks pass on the restored site.
- [ ] Worker rollback and return-to-current-version both pass smoke tests.
- [ ] Production resource and routing inventory is unchanged afterward.
- [ ] Commands, versions, timestamps, hashes, and cleanup results are recorded.

## Detailed feature scopes

### Layer 1 — close the existing MVP recovery gate

Create `F79-remote-recovery-rehearsal.md`.

Deliverables:

- Define a versioned backup manifest containing the deployed commit/artifact identity, Worker version,
  migration/schema version, D1 bookmark and export identity, every R2 key, byte length, ETag where
  available, and SHA-256 checksum.
- Create a production backup without changing production data.
- Restore into isolated staging resources: a new D1 database, a separate R2 bucket, and a staging
  Worker/configuration that cannot receive production mail.
- Verify row counts, schema parity, foreign-key/reference integrity, every referenced R2 object,
  exact object bytes/checksums, authentication bootstrap policy, and representative message and
  attachment reads.
- Exercise Worker rollback independently from data restore.
- Record the commands, timestamps, resource IDs, result hashes, and cleanup procedure as evidence.
- Fail closed on a missing object, checksum mismatch, manifest/version mismatch, wrong account,
  wrong target resource, active Email Routing target, or non-empty restore target.

Cloudflare D1 Time Travel is useful for short-window recovery, but the backup must also include a D1
export for longer-lived or isolated restore testing. R2 durability does not protect against deletion;
the plan therefore requires an actual object copy, not only an inventory. A backup bucket should use
separate credentials and an explicit retention policy. Bucket Lock is optional until retention and
deletion costs are agreed because it intentionally prevents overwrite and deletion.

Exit gate: a production-shaped backup is restored to spare remote resources and all automated
integrity checks pass. Production itself is not overwritten during the rehearsal.

### Layer 2 — operator lifecycle and deployment provenance

Create `F80-operator-lifecycle.md` and `F81-signed-releases.md`.

Deliverables:

- Add a non-mutating `doctor` command that checks runtime version, bindings, D1 migrations, R2 access,
  Queues/DLQ, cron configuration, Email Routing/Sending readiness, provider configuration, public
  smoke endpoints, and required secrets by presence only.
- Produce one immutable deployment artifact per release with version, commit, build timestamp,
  schema compatibility, SHA-256 digest, and release notes.
- Sign a small release manifest in CI; verify signature, product identity, version compatibility, and
  artifact digest before deployment.
- Upload a Worker version without immediately promoting it, smoke the intended version, then promote
  deliberately. Keep database migrations forward-compatible with the currently active version.
- Rehearse upgrade from the previous supported release in disposable Cloudflare resources.
- Record a D1 recovery point, Worker version, R2 manifest, and smoke evidence before production
  promotion.
- Keep deployment authority outside normal member/admin application sessions initially. In-app
  updates can be added only after narrow OAuth permissions, recent reauthentication, audit events,
  and recovery behavior are specified.

Exit gate: a release cannot be promoted if provenance, compatibility, disposable upgrade, smoke, or
recovery checks fail.

### Layer 3 — Operations center and administrative clarity

Create `F82-operations-center.md` and `F83-access-and-security-center.md`.

Operations center:

- Installed application/artifact and schema versions
- Binding and provider readiness without exposing secrets
- Queue, DLQ, cron, retention, orphan, and integrity state
- Last successful backup and last isolated restore rehearsal
- Smoke and traced-mail-flow evidence timestamps
- Read-only diagnostics first; every mutation uses confirmation, recent authentication, audit, and a
  separately authorized server action

Access and security center:

- Organization role versus effective mailbox capabilities
- Bulk mailbox grants with a plain-language access matrix
- Invitation email delivery, resend, expiry, and one-time acceptance state
- Active sessions/devices with revoke-one and revoke-others
- Content-free audit history with actor, action, resource, outcome, request ID, and timestamp
- Immediate access-revocation and cross-tenant negative tests for every new surface

Exit gate: an owner can answer who has access, what changed, whether the platform is healthy, and
whether recovery has been proven without opening Cloudflare or reading logs.

### Layer 4 — MCP as a separately consented API surface

Create `F84-mcp-oauth.md`.

Deliverables:

- OAuth Authorization Code with PKCE, explicit consent, token hashing, expiry, revocation, session
  binding, and resource/audience validation.
- Separate read-only and mail-action resources. New clients default to read-only.
- Reuse the same organization and mailbox capability predicates as web and API-key routes; never
  implement a parallel authorization model.
- Initial tools: list permitted mailboxes, search/list conversations, get message/thread, and bounded
  attachment retrieval.
- Add drafts and state changes next. Add send/reply/forward only after an idempotency-key contract is
  connected to Lumimail's existing durable outbound queue.
- Exclude organization administration, domains, secrets, updates, backups, sessions, and audits.
- Add content-free audit events and negative tests for revoked sessions, changed membership, banned
  users, wrong audience, wrong resource, insufficient scope, and cross-organization identifiers.

Exit gate: MCP cannot observe or perform anything the same user could not do through the normal
mailbox-scoped API, and repeated send requests cannot bypass durable idempotency.

### Layer 5 — mail-client UX and notifications

Create `F85-desktop-split-view.md` and `F86-push-notifications.md`.

Split view:

- Desktop-only resizable conversation list and detail panel with persisted widths
- URL and browser-history synchronization for selection, direct links, back/forward, and refresh
- Existing full-page detail on mobile and as an accessibility fallback
- Keyboard navigation, focus restoration, unread reconciliation, optimistic action rollback, and
  account-switch cache isolation
- Performance budget that avoids fetching message bodies for every list row

Push notifications:

- Per-user subscriptions, device naming, revocation, and VAPID secret handling
- Mailbox authorization checked when enqueuing and again when resolving a notification click
- Minimal payload by default; no body, attachment name, token, or unauthorized mailbox metadata
- Preference controls per device and mailbox, plus bounded retry/cleanup behavior

Exit gate: the enhanced desktop client does not weaken mobile behavior, URL semantics, accessibility,
privacy, or mailbox isolation.

## UI component map by layer

The component names below are planning names. Final names should follow the surrounding Lumimail
conventions when each specification is implemented.

| Layer | Existing component/surface to reuse | Planned component or change | Rule |
|-------|-------------------------------------|-----------------------------|------|
| 1 | No product UI; `scripts/r2-backup.mjs`, `scripts/restore-local.mjs` | Operator CLI output and evidence report only | Recovery mutation stays out of the web app |
| 2 | Deployment scripts, smoke command, queue-health API | `doctor` CLI, release status reader, update-check reader | Read-only before deploy/update controls |
| 3 | `AdminNav`, settings forms, queue-health page, mailbox member APIs | `SettingsShell`, `OperationsOverview`, `RecoveryStatusCard`, `ReleaseStatusCard`, `AccessMatrix`, `InvitationStatusList`, `SessionList`, `AuditEventTable` | Components render server-authorized read models; they do not reproduce authorization |
| 4 | API-key and mailbox capability helpers, compose/draft/send services | `McpConnectionDialog`, `McpProfilePicker`, `OAuthConsentPage`, `ConnectedClientList` | Read-only is the default profile; send uses durable queue idempotency |
| 5 | `MessageFolderPage`, message detail pages, `DashboardNav`, mobile tab bar, service worker | `DesktopMailSplit`, `ConversationList`, `ConversationPanel`, `ResizableMailPanels`, `NotificationDeviceList`, `NotificationPreferences` | Full-page routes remain mobile and accessibility fallback |

## Work packaging

Each phase should be split into independently reversible pull requests:

1. Specification, threat model, manifest/schema contracts, and failing tests.
2. Read-only core or CLI behavior.
3. Mutating behavior with confirmation, compensation, and audit.
4. UI presentation and accessibility tests.
5. Local verification and disposable Cloudflare integration tests.
6. Operator-run production or staging evidence where local equivalence is insufficient.

Every feature follows the repository workflow: update the numbered specification and change log,
add failing tests first, implement the smallest correct behavior, run `npm run verify`, run both E2E
suites for user-visible work, and update `docs/MVP_SCOPE.md` only when evidence supports a status
change.

## Recommended order

1. F79 remote recovery rehearsal — closes the remaining operational MVP gate.
2. F80 operator doctor and lifecycle manifest — low-risk operational leverage.
3. F81 signed release and disposable upgrade pipeline.
4. F82 Operations center.
5. F83 access, invitation, session, and audit UX.
6. F84 OAuth-protected MCP.
7. F85 desktop split view.
8. F86 push notifications.

This order deliberately keeps MCP and visual redesign out of the MVP critical path while still
capturing HQBase's best product ideas.

## Decisions still required

- Long-term backup destination after the same-account MVP rehearsal: separate Cloudflare account or
  an independent S3-compatible provider.
- Backup retention period, legal deletion obligations, and whether Bucket Lock is appropriate.
- Whether releases are published for third-party self-hosters or only used for controlled Lumimail
  deployments initially.
- Whether in-app infrastructure updates are desirable after the safer CLI/CI workflow exists.
- Whether MCP is exposed only on the canonical Lumimail origin or a separate integration origin.
- Whether split view becomes the default on wide screens or starts as an account preference.
