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
- Active session/device inspection and revoke-one/revoke-others.
- Content-free audit history with actor, action, resource, outcome, request ID, and timestamp.

## 3. Security invariants

- The server constructs the read model; the client must not infer access by joining separately
  fetched organization-wide datasets.
- Every member, mailbox, and membership row is constrained to the authenticated user's organization.
- A malformed historical membership that points to a mailbox in another organization is excluded.
- Organization role never implies a mailbox capability. Only an explicit mailbox membership appears
  as mailbox access.
- Mailbox role never implies organization administration.
- Unauthorized and cross-tenant callers receive no partial access inventory.

## 4. Edge cases and error states

- Empty organizations return empty member and mailbox collections.
- Members with no mailbox grants return an empty grants collection.
- Mailboxes with no valid grants return an assigned-member count of zero.
- Duplicate rows are prevented by the existing unique membership constraint; the read model remains
  deterministic if input order changes.
- If the overview cannot be loaded, the page shows a bounded error without leaking database details.
- Unknown mailbox roles fail closed and are not promoted to capabilities.

## 5. Test plan

### Unit/API

- An owner/admin receives only members, mailboxes, and grants from their organization.
- A membership targeting another organization's mailbox is excluded even when it names an in-scope
  user.
- Viewer, responder, and manager roles map to the documented capability sets.
- Members and mailboxes with no grants remain present.
- A regular organization member is denied before database reads.

### Browser

- The access matrix labels organization role and mailbox access as separate concepts.
- A member with multiple grants sees each mailbox and effective capability set.
- A member without grants and a mailbox without assigned users have explicit empty states.
- Restricted users cannot navigate directly to the administrative surface.
- The layout remains usable at desktop and narrow widths.

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

## 7. Open questions

- Should later session and audit views remain owner-only even though the access matrix follows the
  existing owner/admin administration boundary?
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
