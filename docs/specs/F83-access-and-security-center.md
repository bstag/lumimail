# F83 — Access and security center

Status: In Progress
Owner: Platform
Last updated: 2026-08-12

## 1. Current behavior

- `/members` lists organization members and pending invitations, and lets an organization owner or
  admin change non-owner organization roles or remove members.
- Mailbox grants are managed one mailbox at a time under `/mailboxes/[id]`.
- Organization roles (`owner`, `admin`, `member`) and mailbox roles (`viewer`, `responder`,
  `manager`) are stored and enforced separately, but no single screen explains both layers.
- `/api/org/members` is organization-admin scoped. Individual mailbox-member APIs require effective
  mailbox-manager access and preserve tenant isolation through the mailbox access predicate.
- Sessions, invitation delivery state, and content-free audit history are not yet combined into an
  owner-facing security surface.

## 2. Desired behavior

### First slice — read-only access matrix

- Add an owner/admin-readable, organization-scoped access overview derived from the existing
  organization-member, mailbox, and mailbox-membership records.
- Present each organization member's organization role separately from every explicit mailbox grant.
- Explain mailbox roles as effective capabilities: viewer = read, responder = read/send, manager =
  read/send/manage.
- Show members without mailbox grants and mailboxes without assigned members; absence must remain
  visible rather than being silently omitted.
- Keep existing member and mailbox mutation controls unchanged. This slice adds no grant, revoke,
  invitation, session, or audit mutation.

### Later slices

- Bulk mailbox grants with confirmation and content-free audit events.
- Invitation delivery/resend/expiry/acceptance state.
- Revoke-one/revoke-others session controls.
- Content-free audit history with actor, action, resource, outcome, request ID, and timestamp.

### Third slice — recent-authentication foundation

- Store when each exact session most recently proved the account password.
- New sessions start fresh at issuance. Existing sessions are backfilled from their creation time,
  so migration never silently grants a newer proof than actually occurred. Transitional null values
  created by the previously deployed Worker during rollout are never considered recent.
- Add authenticated `POST /api/auth/reconfirm` with a password-only body, per-user durable rate
  limiting, and a 15-minute freshness window.
- A successful reconfirmation updates only the active session presenting the verified bearer or
  cookie credential and returns the freshness expiry timestamp.
- Wrong passwords, a missing presented credential, and a session disappearing between guard and
  update fail with the same bounded `403` response. Rate-limit storage fails closed.
- Add a reusable recent-session predicate for later revoke, bulk-grant, and other high-risk routes.
- This foundation adds no destructive action and no UI prompt by itself.

### Fourth slice — audited session revocation

- Add owner-only targeted revocation and revoke-all-other-session mutations to the existing active
  session surface.
- Require the exact requesting session to be inside the 15-minute recent-authentication window
  before either mutation reads or deletes a target session.
- A targeted revocation accepts only an opaque session ID from the route path and may delete only an
  active session whose stored organization matches the owner's active organization. It cannot
  revoke the requesting session; current-session termination remains the explicit logout flow.
- Revoke others deletes every other active session carrying the owner's active organization ID,
  including stale malformed rows no longer visible through the current-member inventory, while
  preserving exactly the session presenting the request credential.
- Add a password confirmation dialog for each destructive action. The client first reconfirms the
  password through `/api/auth/reconfirm`, then performs the selected mutation, keeps a failed dialog
  open with a bounded error, and refreshes the session inventory after success.
- Persist each successful mutation in the same D1 batch as its deletion using a content-free audit
  row: organization ID, actor user ID, action, opaque target session ID when applicable, affected
  count, server-generated request ID, outcome, and timestamp.
- Audit rows never store session tokens or digests, password material, email addresses, IP addresses,
  user agents, request bodies, mailbox/message content, or provider response bodies. Audit history UI
  remains a later slice.

### Fifth slice — owner-visible security history

- Add owner-only `GET /api/admin/security-events` and a Security history card on `/members`.
- Return only the content-free metadata already persisted in `security_audit_events`: opaque event,
  actor, resource, and request IDs; action; resource type; affected count; outcome; and timestamp.
- Scope every query by the authenticated owner's active organization. Organization admins and
  members are denied before the audit table is read.
- Use descending keyset pagination ordered by timestamp and opaque event ID. The default page is 20,
  the server-enforced maximum is 50, and the server returns a cursor only when an older row exists.
- Treat the cursor as navigation state, never authorization. A malformed cursor returns a bounded
  `400`; a valid cursor can never widen the organization predicate.
- Resolve actor labels only from member data already authorized on `/members`. The audit endpoint
  itself does not join or return email addresses, and a removed actor has an explicit fallback label.
- This slice is read-only. It does not add retention, export, filtering, denied-attempt logging, or
  a new migration.

### Second slice — read-only active sessions

- Add an owner-only organization session inventory containing account identity, issued time, expiry,
  and whether a row is the session making the request.
- Return active, organization-bound sessions only. Expired, cross-organization, and malformed rows
  are excluded even if they reference an in-scope user.
- Expose the opaque session row ID for stable rendering and future targeted revocation, but never
  return the session token, token lookup digest, or bcrypt hash.
- Do not label sessions as devices or locations because the current schema does not capture user
  agent, IP address, last-seen time, or device identity.
- Add no revocation mutation in this slice.

## 3. Security invariants

- The server constructs the read model; the client must not infer access by joining separately
  fetched organization-wide datasets.
- Every member, mailbox, and membership row is constrained to the authenticated user's organization.
- A malformed historical membership that points to a mailbox in another organization is excluded.
- Organization role never implies a mailbox capability. Only an explicit mailbox membership appears
  as mailbox access.
- Mailbox role never implies organization administration.
- Unauthorized and cross-tenant callers receive no partial access inventory.
- Organization-wide session visibility is owner-only; an organization admin is denied before the
  session query runs.
- Current-session marking uses the same bearer-first, cookie-second credential precedence as
  authentication and compares only a derived digest in memory.
- Password reconfirmation never accepts a user ID, organization ID, or session ID from the request
  body; all three are derived from the authenticated request and exact credential.
- Reconfirmation failure uses `403`, not `401`, so the browser does not treat a wrong password as a
  lost authenticated session.
- Revocation authorizes against the current owner and exact presented session; a path session ID is
  never treated as authorization and every deletion includes the active organization predicate.
- A successful deletion and its audit event are atomic. If the audit write fails, D1 rolls back the
  deletion and the API returns a bounded failure.
- Security history is owner-only, organization-scoped in SQL, content-free at the API boundary, and
  bounded independently of caller input.

## 4. Edge cases and error states

- Empty organizations return empty member and mailbox collections.
- Members with no mailbox grants return an empty grants collection.
- Mailboxes with no valid grants return an assigned-member count of zero.
- Duplicate rows are prevented by the existing unique membership constraint; the read model remains
  deterministic if input order changes.
- If the overview cannot be loaded, the page shows a bounded error without leaking database details.
- Unknown mailbox roles fail closed and are not promoted to capabilities.
- An organization with no active sessions returns an empty list and zero count.
- A valid request whose current session is absent from the organization-bound result returns no row
  marked current rather than widening the query.
- Equal creation timestamps are ordered deterministically by opaque session ID.
- Existing sessions older than 15 minutes are not recent immediately after migration.
- A session expiring during reconfirmation is not updated and receives the same bounded failure.
- A successful reconfirmation of one session does not refresh any other session for the same user.
- Targeting the current session is rejected without deletion or audit; the UI never offers that
  action on the current row.
- An unknown, expired, already-revoked, or cross-organization target receives the same `404` response.
- Revoke others succeeds with an affected count of zero and still records the owner's confirmed
  action; repeated use is therefore safe and observable.
- If another request removes a validated target before the atomic deletion batch runs, the mutation
  is treated as idempotently successful and the audit record remains an accurate record of the
  owner's confirmed request.
- An organization with no audit events returns an empty first page and no cursor.
- Events with equal timestamps are ordered deterministically by opaque event ID with no duplicates
  between pages.
- A cursor from another organization reveals no event and cannot cross the active organization
  predicate; it simply positions the requesting organization's own history.
- Unknown historical actor IDs remain visible as `Former member` rather than dropping the event or
  joining an identity outside the current authorized member set.

## 5. Test plan

### Unit/API

- An owner/admin receives only members, mailboxes, and grants from their organization.
- A membership targeting another organization's mailbox is excluded even when it names an in-scope
  user.
- Viewer, responder, and manager roles map to the documented capability sets.
- Members and mailboxes with no grants remain present.
- A regular organization member is denied before database reads.
- An owner receives active sessions for current members only, with expired and cross-tenant rows
  excluded.
- The presented bearer or cookie session is marked current without returning credential material.
- Organization admins and members are denied before session reads.
- New session creation persists the initial authentication timestamp.
- Migration parity proves fresh and upgraded databases preserve authentication age, while the
  transitional nullable column remains insert-compatible with the previously deployed Worker.
- Reconfirmation validates the body, fails closed when rate-limit storage is unavailable, rate
  limits repeated attempts, verifies the current password, and updates only the presented session.
- The reusable freshness predicate accepts the exact active session inside 15 minutes and rejects
  absent, expired, other-user, other-session, and stale rows.
- Target revocation denies non-owners and stale sessions before target reads, returns one bounded
  `404` for out-of-scope targets, rejects the current session, and batches deletion with audit.
- Revoke others preserves the exact presented session, scopes deletion by organization, returns the
  affected count, and batches deletion with audit even when the count is zero.
- Audit persistence contains only the specified metadata and has organization/timestamp indexes.
- Audit-history reads deny non-owners before database access, enforce organization scope and the
  50-row maximum, reject malformed cursors, and return deterministic non-overlapping pages.
- The audit response contains no credential, email, network, request-body, message, or provider data.

### Browser

- The access matrix labels organization role and mailbox access as separate concepts.
- A member with multiple grants sees each mailbox and effective capability set.
- A member without grants and a mailbox without assigned users have explicit empty states.
- Restricted users cannot navigate directly to the administrative surface.
- The layout remains usable at desktop and narrow widths.
- Owners see session identity, creation, expiry, and current-session state; admins do not request or
  render the owner-only session inventory.
- Owners can revoke a non-current session or all other sessions only after entering a password in an
  explicit destructive confirmation dialog.
- The current-session row has no revoke control; successful revocation refreshes the active count,
  and a failed reconfirmation or mutation keeps the dialog open with its error.
- Owners see content-free security events, can load older pages, and see a stable removed-actor
  fallback; admins neither request nor render the owner-only history.

### Verification

- `npm run verify`
- `npm run e2e`
- production build, deployment, public smoke, and anonymous authorization denial

## 6. Decisions

- Decision 2026-08-12: begin with read-only explanation over existing authorization records; do not
  combine this with grant mutations.
- Decision 2026-08-12: allow existing organization owners and admins to read the matrix because both
  roles already manage organization members and mailbox inventory.
- Decision 2026-08-12: reuse the existing mailbox-role capability contract rather than creating a
  second authorization model for the UI.
- Decision 2026-08-12: extend `/members` with an access-matrix section instead of adding another
  navigation destination in the first slice.
- Decision 2026-08-12: make organization-wide session inventory owner-only because it exposes other
  users' authentication activity, while leaving the access matrix on the existing owner/admin
  administration boundary.
- Decision 2026-08-12: describe rows as sessions, not devices. Device/location claims wait for an
  explicit metadata and privacy contract.
- Decision 2026-08-12: defer session revocation until recent-authentication, confirmation, and
  content-free audit behavior are specified together.
- Decision 2026-08-12: use a 15-minute recent-authentication window and refresh it only through an
  explicit password proof on the exact current session.
- Decision 2026-08-12: backfill `authenticated_at` from `created_at`; migration must never make an old
  session newly recent.
- Decision 2026-08-12: keep `authenticated_at` nullable for the rolling-deploy boundary because D1
  migrates before Worker publication. New code always writes it, and null fails closed, so a failed
  publication cannot break login on the previously deployed Worker or grant freshness.
- Decision 2026-08-12: make `/api/auth/reconfirm` reusable for any authenticated user while keeping
  organization-wide session inspection owner-only.
- Decision 2026-08-12: targeted revocation cannot delete the current session. Logout remains the
  unambiguous current-session control and avoids returning success through a newly invalid session.
- Decision 2026-08-12: revoke others scopes by the session's stored organization and intentionally
  removes malformed organization-bound rows even when the read-only inventory hides them because a
  current membership join is absent.
- Decision 2026-08-12: persist successful deletion and audit insertion in one D1 batch. A concurrent
  prior deletion is idempotent; the event records the confirmed action rather than claiming a device.
- Decision 2026-08-12: generate a request ID on the server instead of trusting a caller-controlled
  header. Audit history presentation, retention, export, and failed/denied-attempt logging remain
  separate contracts.
- Decision 2026-08-12: expose security history as a read-only fifth slice before bulk grants. Keep
  retention, export, filtering, and denied-attempt logging out of this contract.
- Decision 2026-08-12: use a timestamp-plus-event-ID keyset cursor with a 20-row default and 50-row
  maximum. The cursor is validated navigation state and never replaces the organization predicate.
- Decision 2026-08-12: keep the audit API identity-minimal. The page may label an actor from its
  separately authorized current-member dataset, but the history response returns only actor user ID.

## 7. Open questions

- Which transactional email provider should deliver invitations, and what resend rate limit applies?

## 8. Bug / change log draft

### 2026-08-12 — Specify a read-only access matrix

Type: Feature

Summary:

- Define a tenant-scoped read model and `/members` presentation that separates organization role
  from explicit mailbox capabilities.

Reason:

- Existing controls enforce both layers but require operators to inspect every mailbox separately to
  answer who can read, send, or manage mail.

Impact:

- Specification first. The initial implementation is read-only and does not alter access.

### 2026-08-12 — Implement the first read-only access matrix

Type: Feature

Summary:

- Add `/api/admin/access-overview`, which builds one organization-scoped read model from members,
  mailboxes, domains, and explicit mailbox memberships.
- Extend `/members` with a responsive access matrix showing workspace role, mailbox role, effective
  read/send/manage capabilities, members without access, and mailboxes without assignments.

Security:

- The endpoint reuses the owner/admin guard and performs no database read for a denied caller.
- Both SQL joins and the pure read-model builder reject cross-organization member or mailbox rows,
  nonexistent references, and unknown historical roles.
- Organization roles remain presentation-only and never create mailbox capabilities.

Verification:

- Focused service/API contracts passed after first failing for the absent implementation.
- Full `npm run verify` passed 1,899 tests with 100% statement, branch, function, and line coverage,
  plus all 21 IMAP bridge tests.
- Full `npm run e2e` passed 76 Chromium scenarios, including explicit no-access/no-assignment states
  and the access matrix at a 390px viewport.
- No migration or mutation path was added.
- Commit `588c0ff` deployed as Worker version `8dc958d6-adc4-403c-b570-802ebb730609` with no pending
  migrations and all nine expected runtime bindings. The production build includes
  `/api/admin/access-overview`.
- Public smoke passed 6/6, the new endpoint returned `401` to an anonymous caller, and the remote
  doctor passed 25 checks with zero failures and the documented live-Cron-inventory warning.
- Authenticated matrix rendering remains covered by the production-shaped browser suite; no
  production credential was requested or reused for automation.

### 2026-08-12 — Specify owner-only active-session visibility

Type: Feature

Summary:

- Define a read-only organization session inventory showing identity, issued time, expiry, and the
  current session without exposing credential material.

Reason:

- Let an owner see active authentication state before adding destructive revoke controls.

Impact:

- Specification only at this checkpoint. No schema or session mutation is introduced.

### 2026-08-12 — Implement owner-only active-session visibility

Type: Feature

Summary:

- Add owner-only `/api/admin/sessions` and an Active sessions card on `/members`.
- Show account identity, creation, expiry, active count, and the session making the request.
- Keep organization admins on the access matrix without requesting the owner-only session dataset.

Security:

- The endpoint denies non-owners before reading the presented cookie or querying sessions.
- The query requires both the session and current organization membership to match the owner's
  organization and requires an unexpired session; the pure read model repeats those checks.
- Bearer credentials take precedence over the cookie exactly as they do for authentication. Only a
  derived lookup is compared, and the response omits lookup digests, hashes, and credentials.
- No device, location, IP, user-agent, last-seen, or revocation claim was added.

Verification:

- Focused service/API tests passed after first failing for the absent implementation.
- Full `npm run verify` passed 1,908 tests with 100% statement, branch, function, and line coverage,
  plus all 21 IMAP bridge tests.
- Full `npm run e2e` passed 78 Chromium scenarios. Owner rendering/current marking and zero admin
  requests are explicit browser contracts.
- No schema migration or mutation path was added.
- Commit `262017f` deployed as Worker version `7d483386-6c92-410a-bb8b-b286c4f99f8c` with no pending
  migrations and all nine expected runtime bindings. The production build includes
  `/api/admin/sessions`.
- The first migration preflight was rejected by Cloudflare with account authorization code `7403`
  before build or publication. `wrangler whoami` confirmed the expected account and D1 permission;
  the unchanged retry passed and deployed normally.
- Public smoke passed 6/6, the new endpoint returned `401` to an anonymous caller, and the remote
  doctor passed 25 checks with zero failures and the documented live-Cron-inventory warning.
- Authenticated owner/admin rendering remains covered by the production-shaped browser suite; no
  production credential was requested or reused for automation.

### 2026-08-12 — Specify recent authentication

Type: Security foundation

Summary:

- Define exact-session password reconfirmation, a 15-minute freshness predicate, durable attempt
  limiting, and a migration-safe authentication timestamp.

Reason:

- Destructive security controls must prove recent intent rather than relying on possession of a
  potentially month-old session.

Impact:

- Specification only at this checkpoint. No revoke or bulk-access mutation is added.

### 2026-08-12 — Implement exact-session recent authentication

Type: Security foundation

Summary:

- Add migration `0029`, initial authentication timestamps on new sessions, authenticated
  `POST /api/auth/reconfirm`, and a reusable 15-minute freshness predicate.
- Apply a durable per-user limit of five password-confirmation attempts per 15 minutes.

Security:

- Password proof updates only the exact unexpired session represented by the bearer-first,
  cookie-second request credential. Missing credentials, wrong passwords, and disappearing sessions
  share one bounded `403` response.
- Existing rows inherit their original session creation time. Transitional null timestamps from the
  rolling-deploy boundary fail closed and never satisfy the freshness predicate.
- Migration `0029` deliberately permits the old Worker to keep inserting sessions if publication
  stops after D1 migration, preventing an authentication outage without granting recent status.

Verification:

- Tests were written first and failed for the absent migration, service, route, and session field.
- Focused migration, session, service, and route contracts pass 35/35.
- Full `npm run verify` passes 1,920 tests with 100% statement, branch, function, and line coverage,
  plus all 21 IMAP bridge tests. Existing lint warnings remain at 36 with zero errors.
- Full `npm run e2e` passes all 78 Chromium scenarios after advancing the Operations schema contract
  to `0029`; this backend-only foundation adds no new UI flow.
- A migrated local D1 copy applied `0029` successfully and a second migration pass reported no
  pending migrations.
- Commit `df81009` deployed as Worker version `76dfd2e5-2f15-4de9-a765-c1fb242820a7`; remote D1
  applied `0029`, the production build includes `/api/auth/reconfirm`, and a second remote migration
  pass reports no pending migrations.
- Public smoke passes 6/6, anonymous `POST /api/auth/reconfirm` returns the bounded `401` envelope,
  and the remote doctor passes 25 checks with zero failures and the documented live-Cron-inventory
  warning.
- Successful authenticated password proof remains covered by the production-shaped service/API
  suite; no production password or session credential was requested for automation.

### 2026-08-12 — Specify audited session revocation

Type: Security feature

Summary:

- Define owner-only revoke-one and revoke-others controls protected by exact-session recent
  authentication, explicit password confirmation, and atomic content-free audit records.

Reason:

- Session visibility is useful only if an owner can safely terminate compromised or obsolete access
  without exposing credential material or creating unaudited destructive behavior.

Impact:

- Specification first. Implementation, migration `0030`, browser behavior, and deployment evidence
  follow after failing tests establish the contracts.

### 2026-08-12 — Implement audited session revocation

Type: Security feature

Summary:

- Add owner-only `DELETE /api/admin/sessions/[id]` and
  `POST /api/admin/sessions/revoke-others`, both protected by the exact requesting session's recent
  password proof.
- Extend the owner session card with password-confirmed revoke-one and revoke-others controls while
  leaving the current session to the existing logout flow.
- Add migration `0030` and atomically persist successful deletion with a bounded security audit row.

Security:

- Current-session context must match the owner's active organization before target reads. Targeted
  deletion uses opaque ID, organization, and active-expiry predicates; revoke others preserves the
  exact presented session and removes every other active organization-bound row.
- Audit events contain only organization/actor opaque IDs, action/resource metadata, affected count,
  a server-generated request ID, outcome, and timestamp. No credential, password, address, network,
  client, body, message, or provider data is stored.
- D1 batch failure propagates as a bounded API failure; deletion is never reported successful when
  its audit insertion cannot commit.

Verification:

- Migration, recent-session context, service, and route tests were written first and failed for the
  absent files/functions. The focused backend contracts pass, including owner denial, cross-org and
  stale-session refusal, current-session protection, zero-target idempotence, content minimization,
  and batch-failure propagation.
- Full `npm run verify` passes 1,940 tests with 100% statement, branch, function, and line coverage,
  plus all 21 IMAP bridge tests. Existing lint warnings remain at 36 with zero errors.
- Full `npm run e2e` passes 81 Chromium scenarios. New scenarios prove password-before-mutation,
  failed-password dialog persistence, inventory refresh, and exact current-session preservation.
- A migrated local D1 copy applied `0030` successfully and the second pass reported no pending
  migrations.
- Commit `437b70b` deployed as Worker version `0a5a08a8-e846-47a1-a697-9d16751a74dc`; remote D1
  applied `0030`, and the production build includes both session-revocation routes.
- At initial deployment, a schema-only remote D1 query confirmed the exact ten content-free audit
  columns before any live row was written. A second remote migration pass reported no pending
  migrations.
- Public smoke passes 6/6. Anonymous requests to a normal session-ID-shaped target and to
  `/api/admin/sessions/revoke-others` both return the bounded JSON `401` envelope.
- The remote doctor passes 25 checks with zero failures and the documented live-Cron-inventory
  warning. On 2026-08-12 the operator confirmed a live production session was revoked through the
  published control, closing the authenticated destructive-action production gate without sharing
  a password or session credential with automation.

### 2026-08-12 — Specify owner-visible security history

Type: Security feature

Summary:

- Define an owner-only, organization-scoped audit-history endpoint and `/members` card over the
  existing content-free security events.
- Define deterministic keyset pagination with a 20-row default, 50-row maximum, and explicit empty,
  removed-actor, invalid-cursor, and tenant-isolation behavior.

Reason:

- Owners can now perform audited session revocations, but the resulting evidence is not visible in
  the product without direct database access.

Impact:

- Specification first. This slice is read-only, introduces no migration, and does not broaden the
  audit event schema or collect credentials, message content, network data, or request bodies.

### 2026-08-12 — Implement owner-visible security history

Type: Security feature

Summary:

- Add owner-only `GET /api/admin/security-events` over the existing audit table with descending
  timestamp/event-ID keyset pagination, a 20-row default, and a strict 50-row maximum.
- Add a Security history card on `/members` with current-member actor labels, a removed-member
  fallback, request IDs, timestamps, explicit empty state, and incremental loading.
- Refresh both active sessions and security history after a successful session revocation.

Security:

- The owner guard runs before query parsing reaches the history service or any audit database read.
- SQL and the response builder both enforce the active organization; a cursor only adds a descending
  boundary and never substitutes for tenant scope.
- The endpoint returns only content-free audit fields. It performs no user join and returns no email,
  credential, network, request-body, message, or provider data.

Verification:

- Service and route tests were written first and failed for the absent implementation. They cover
  cursor validation, limit enforcement, owner-before-read denial, tenant filtering, empty pages,
  deterministic limit-plus-one pagination, response minimization, and the D1-backed entry point.
- `npm run verify` passes 1,960 tests with 100% statement, branch, function, and line coverage, plus
  all 21 IMAP bridge tests. The existing 36 lint warnings remain with zero errors.
- `npm run e2e` passes all 83 Chromium scenarios. New contracts prove owner rendering, older-page
  loading, current-member and removed-member labels, content minimization, and zero admin requests.
- No schema migration or new dependency was added.
- Commit `5904aad` deployed as Worker version `03ff1476-a7ee-4569-a9a1-1e8b4a909038`; remote D1 had
  no pending migrations, and the production build includes `/api/admin/security-events`.
- Public smoke passes 6/6 and an anonymous history request returns the bounded JSON `401` envelope.
  The remote doctor passes 25 checks with zero failures and the documented live-Cron-inventory
  warning.
- A metadata-only remote D1 aggregation now reports exactly one `session.revoke` event, proving the
  operator-confirmed production revocation committed its content-free audit record. The signed-in
  owner card remains a human-visible check; no production session credential was reused by automation.
