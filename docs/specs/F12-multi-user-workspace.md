# F12 — Multi-User Workspace (Organizations, Invites, Roles)

> Status: Partially Shipped
> Owner area: `src/app/api/org/*`, `src/lib/auth/org-guard.ts`, `src/app/(admin)/members/`, `src/db/schema/`

Organization membership and invitations do not define mailbox-content access. The least-privilege shared-mailbox follow-on is specified separately in [F47](./F47-mailbox-access-control.md); where this historical specification describes organization-wide mailbox visibility or personal message ownership, F47 controls the desired behavior.

## 1. Problem & User Job

Today, Lumimail is a single-user system — each registration creates a 1-person org
where the user is `owner`. A "Google Workspace replacement" needs org admins to
provision domains/mailboxes and invite team members who share those resources while
keeping their own inbox private.

## 2. User Stories & Acceptance Criteria

- As an **org admin**, I can invite team members by email to join my workspace.
  - Given I'm on the members page, when I enter an email + role and click invite,
    then an invite is created with a unique token link.
- As an **invited user**, I can register via the invite link and join the existing org.
  - Given I visit `/register?token=<valid>`, when I complete registration,
    then I join the inviter's org with the assigned role and get a mailbox.
- As an **org owner**, I can change a member's role or remove them.
  - Given I click a member's role dropdown, when I select a new role,
    then the member's role updates immediately.
  - Given I click "Remove" on a member, when I confirm,
    then the member is removed and can no longer see org resources.
- As a **member**, I can see only mailboxes explicitly assigned to me and the messages stored in those mailboxes.
  - Given I view the mailbox selector, I see only mailboxes granted through F47 membership.
  - Given I view inbox/sent/drafts, mailbox-scoped data follows F47 while null-mailbox personal data remains private.
- As an **admin**, I manage org domains and mailboxes that all members share.
  - Given I add a domain or create a mailbox, it's scoped to the org, not just me.

## 3. Scope Boundaries

**In scope:**
- `orgInvites` table with token-based invitation
- `GET/POST /api/org/members` — list members, create invite
- `PATCH/DELETE /api/org/members/[memberId]` — change role, remove
- `GET /api/org/invites/[token]` — validate invite token
- Switch domain/mailbox/routing-rule queries from `userId` to `organizationId`
- Invite token on registration page (`?token=`)
- Admin members management page with invite dialog
- Role-based guard on all org-management endpoints

**Out of scope:**
- Email-based invite delivery (copy link, no SMTP sending)
- Domain/mailbox/routing-rule PATCH and DELETE routes
- Bulk member CRUD
- Org rename / org delete
- Audit logging

## 4. Data Model

### New table: `orgInvites`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `text` PK | `newId("inv")` |
| `organizationId` | `text` FK → organizations.id cascade | |
| `email` | `text` not null | |
| `role` | `text` enum: `admin` \| `member`, default `member` | |
| `token` | `text` not null unique | `newId("tok")` — registration link token |
| `expiresAt` | `timestamp` not null | 7-day expiry |
| `createdAt` | `timestamp` $defaultFn | |

### Existing tables — query scope change (no schema change)

| Table | Current scope | New scope |
|-------|---------------|-----------|
| `domains` | `eq(domains.userId, user.id)` | `eq(domains.organizationId, user.organizationId)` |
| `mailboxes` (list) | `eq(mailboxes.userId, user.id)` | `eq(mailboxes.organizationId, user.organizationId)` |
| `routingRules` (list) | `eq(routingRules.userId, user.id)` | `eq(routingRules.organizationId, user.organizationId)` |
| `messages` | `eq(messages.userId, user.id)` | **unchanged** (personal) |
| `drafts` | `eq(messages.userId, user.id)` | **unchanged** (personal) |

**Note:** `organizationId` column already exists on all resource tables (from
backfill migration). No schema changes needed — just query filter changes.

### Migration

```sql
CREATE TABLE "org_invites" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "token" text NOT NULL UNIQUE,
  "expires_at" integer NOT NULL,
  "created_at" integer NOT NULL
);
```

## 5. API Contract

### Org Members

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/org/members` | `guardOrgAdmin` | — | `{ members: { id, name, email, role, joinedAt }[], invites: { id, email, role, expiresAt }[] }` | 401, 403 |
| POST | `/api/org/members` | `guardOrgOwner` | `{ email, role }` | `{ invite: { id, token } }` | 400, 403, 409 (already member) |
| PATCH | `/api/org/members/[memberId]` | `guardOrgOwner` | `{ role: "admin" \| "member" }` | `{ ok: true }` | 400, 403, 404, 400 (cannot change owner) |
| DELETE | `/api/org/members/[memberId]` | `guardOrgOwner` | — | `{ ok: true }` | 401, 403, 404, 400 (cannot remove owner) |

### Invite Validation

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/org/invites/[token]` | none | — | `{ email, orgName, role, expiresAt }` | 404 (invalid/expired) |

### Registration (updated)

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/auth/register` | none | existing fields + optional `inviteToken` | `{ ok, token, redirect }` | 400, 409, 502 |

When `inviteToken` is provided and valid:
- Look up the invite, get `organizationId` and `role`
- Create user with that `organizationId` (no `ensureUserOrg` needed)
- Create org membership row with the invited role
- Delete the invite
- Mailbox is created on the org's primary domain, same as before

## 6. UI/UX

### Members page — `src/app/(admin)/members/page.tsx`

- List of current members: name, email, role badge, joined date
- "Invite member" button opens dialog
- Each row: role dropdown (owner-only) + "Remove" button (owner-only)
- Cannot remove/change the owner
- Pending invites section below: email, role, "Copy link" button, expires

### Invite dialog — `src/components/admin/invite-member-dialog.tsx`

- Email input + role dropdown (`admin` \| `member`)
- Submit creates invite, shows token link with "Copy link" button
- Link format: `{origin}/register?token={token}`

### Registration update — `src/app/register/register-client.tsx`

- On mount, check `?token=` search param
- If token: fetch `/api/org/invites/[token]`, show "You've been invited to join {orgName}"
- Registration form: username + password (domain is org's primary domain)
- Submit includes `inviteToken` in body

### Admin nav — `src/components/admin-nav.tsx`

- Add "Members" nav item (icon: `Users` from lucide-react)

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/auth/org-guard.test.ts` | guardOrgUser/Admin/Owner: auth missing, wrong role, correct role |
| Integration | `tests/unit/app/api/org/members.test.ts` | list members, create invite, accept invite flow, change role, remove member, cross-org isolation |
| Integration | `tests/unit/app/api/org/members-scope.test.ts` | domains/mailboxes visible across org members, messages private per user |
| E2E | `tests/e2e/org-members.spec.ts` | full invite → register → login → see shared mailboxes flow |

## 8. Current Behavior

- Every user is `owner` of their own 1-person org (via `ensureUserOrg`)
- All resources scoped by `userId`
- `guardOrgUser/Admin/Owner` defined but unused
- No member management API or UI
- Registration doesn't accept invite tokens

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|--------------|---------|
| Non-admin lists members | "Forbidden" | 403 | no |
| Non-owner invites/removes | "Forbidden" | 403 | no |
| Invite duplicate email (already member) | "Already a member" | 409 | no |
| Invite token expired | "Invite not found" | 404 | no |
| Invite token invalid | "Invite not found" | 404 | no |
| Cannot change/remove owner | "Cannot modify the owner" | 400 | no |
| Missing `inviteToken` or invalid mail | "Validation failed" | 400 | no |

## 10. Edge Cases

- Invite already-registered email → 409, don't create invite
- Invite email matches existing invite (re-invite) → update existing invite (new token, new expiry)
- Token used after member removed → register fails, token is orphaned (clean up on use)
- Owner tries to leave org → 400, must transfer ownership first (out of scope)
- Concurrent invite acceptance → first wins, second sees "token not found"
- Org has no primary domain → invites work but mailbox creation fails; handled by existing registration flow
- Empty member list → empty state UI

## 11. Permissions & Security

- `guardOrgAdmin` on GET /api/org/members
- `guardOrgOwner` on POST/PATCH/DELETE /api/org/members
- Invite validation endpoint is **unauthenticated** (public) — only returns email + org name + role, no sensitive data
- Cross-tenant: member A cannot list member B's org; member cannot PATCH/DELETE another org's members
- Token is single-use: deleted after registration or validated once

## 12. Open Questions / Decisions

- Q: Should invites send email? → No for MVP — copy link only. Email sending requires SMTP setup which is out of scope.
- Q: What happens to member's mailbox when removed? → Mailbox stays. Admin must delete it separately via mailbox management.
- Q: Can an owner demote themselves? → No — blocked at API level (400).

## 13. Bug / Change Log

### 2026-06-10 — Initial multi-user workspace implementation

Type: Feature

Summary:
- Added `orgInvites` table and invite token flow
- Switched domain/mailbox/routing-rule queries from `userId` to `organizationId`
- Built org members CRUD API with role-based guards
- Added invite acceptance to registration flow
- Built admin member management page with invite dialog

Reason:
- Multi-user workspace required for Google Workspace replacement positioning

Impact:
- All domain, mailbox, and routing-rule queries now org-scoped
- Registration supports invite tokens
- Admin nav gains Members item

Tests:
- None added (test infrastructure needs D1 integration setup)

### 2026-06-10 — Bug fixes after audit

Type: Bug Fix

Summary:
- Fixed register page not reading `?token=` from URL (invite link was dead)
- Fixed `copyInviteLink` passing `invite.id` instead of `invite.token`
- Fixed `mailboxes.organizationId` never set on INSERT (all new mailboxes had null org)
- Fixed mailbox detail route still scoped to `userId` instead of org
- Fixed routing rules POST domain ownership check using `userId`
- Added `PATCH /api/domains/[id]` to toggle routing/sending
- Added `DELETE /api/mailboxes/[id]` 
- Added full CRUD at `/api/routing-rules/[id]` (GET, PATCH, DELETE)
