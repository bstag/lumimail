# F49 — Identity-Bound Organization Invitations

> Status: Implemented Locally — Deployment Pending
> Remediation: R-22
> Owner area: `src/app/api/org/members/route.ts`, `src/app/api/org/invites/[token]/route.ts`, `src/app/api/auth/register/route.ts`, `src/app/register/`, `src/components/admin/`

## 1. Problem and user job

An administrator should be able to invite a person to the Lumimail workspace without accidentally creating an email mailbox or allowing the link holder to choose a different identity.

The current invitation records an external email address, but registration ignores that address. The link holder chooses a username on the workspace primary domain, receives a new mailbox and Cloudflare routing rule, and joins the organization. Pending-invite listings also return reusable plaintext tokens.

For the intended two-to-four-user workspace, account identity, organization membership, and mailbox access must remain separate:

- the invited external address is the login identity;
- accepting an invitation creates only the user and organization membership;
- an administrator grants mailbox access separately through F47;
- possession of an invitation never creates a new receiving address.

## 2. Current behavior

- An admin creates an invite containing `email`, organization role, plaintext token, and seven-day expiry.
- The raw token is stored in `org_invites.token`.
- `POST /api/org/members` reveals the token once, but `GET /api/org/members` also returns it for every pending invite.
- The members page reconstructs reusable links from the listing response.
- Public invite lookup compares the URL token directly to the stored plaintext token.
- Invite registration accepts `username`, `password`, and `resetEmail`.
- Registration derives `users.email` as `username@<workspace-primary-domain>` instead of using the invited email.
- Invite registration provisions a same-domain mailbox and Cloudflare Email Routing rule.
- The invited email is displayed on the page but is not the identity written to the database.
- A globally registered address can be invited even though Lumimail currently supports one active organization per user.

## 3. Desired behavior

### 3.1 Invitation creation and storage

- Admin-only behavior remains unchanged.
- Invite email is trimmed, lowercased, and validated as an email address.
- Organization role is explicitly validated as `admin` or `member`; an unknown role is rejected rather than silently elevated or defaulted.
- An email already registered anywhere in Lumimail cannot receive a new-organization invite while one-organization-per-user remains the product model.
- Reissuing an active invite rotates the token, role, and seven-day expiry; the previous link stops working.
- The raw token is returned only by the successful create/reissue response.
- `GET /api/org/members` returns pending invite metadata without any token or link.
- The existing `org_invites.token` column stores a SHA-256 token hash. No raw invitation token is stored after F49.

### 3.2 Invitation inspection and acceptance

- Public invite lookup hashes the URL token before querying.
- Invalid and expired links remain non-accepting and reveal only the existing safe error.
- The registration page shows the invited email as a non-editable account identity.
- Invite registration accepts only `inviteToken`, `password`, and `resetEmail`; a client-supplied username or email cannot change the identity.
- The server takes `users.email` and the account name from the invite record.
- Successful acceptance conditionally claims and consumes the invite before atomically creating the user and organization membership in one D1 batch.
- Invite acceptance does not call domain discovery, Cloudflare APIs, mailbox insertion, or routing-rule provisioning.
- The new user initially sees no mailbox until an administrator grants F47 membership.
- A used link cannot be replayed.

### 3.3 Scope boundaries

In scope:

- copy-link invitation delivery;
- hashed-at-rest invitation tokens;
- one-time token reveal;
- identity-bound account creation;
- organization membership without mailbox creation;
- safe existing-user rejection;
- truthful pending-invite UI.

Out of scope:

- emailing invitations automatically;
- multi-organization account switching;
- automatically granting mailbox access;
- invitation cancellation UI;
- invitation audit history;
- proof that the administrator controls the invited external address beyond securely sharing the link.

## 4. API contracts

### `GET /api/org/members`

Pending invitation shape:

```ts
{
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  createdAt: string;
}
```

The response never contains `token`, `tokenHash`, or a registration URL.

### `POST /api/org/members`

Request:

```ts
{ email: string; role: "admin" | "member" }
```

Success:

```ts
{ invite: { id: string; token: string } }
```

The token is a one-time display secret. Re-fetching the member list cannot recover it.

Errors:

- `400` invalid body/email/role;
- `401` unauthenticated;
- `403` not an organization admin;
- `409` already a member, already registered, or otherwise ineligible.

### `POST /api/auth/register` with an invitation

Request:

```ts
{
  inviteToken: string;
  password: string;
  resetEmail: string;
}
```

The ordinary first-run and primary-domain registration contracts remain unchanged when `inviteToken` is absent.

## 5. Edge cases and error states

- Reissuing an invite invalidates the earlier link immediately.
- Existing plaintext production invitation rows cannot be made hashed-at-rest without retaining their raw secret. F49 intentionally invalidates them; the deployment check must count pending rows and the admin must reissue any that exist.
- A malformed JSON body returns `400`, not `500`.
- An invalid email or role returns `400`.
- An expired token behaves like an invalid token during registration.
- If another request registers the invited email first, acceptance returns a safe conflict and must not create membership.
- Concurrent acceptance has one winner; the database uniqueness/atomic batch prevents two users or memberships.
- If the account/membership batch fails after a successful claim, the hashed invitation row is restored without exposing the raw token.
- An organization without a primary domain can still invite and register a user because acceptance creates no mailbox.
- The recovery email may equal the invited login email.

## 6. Test plan

### Unit/integration

- hash helper is deterministic and never returns the raw token;
- member listing excludes token data;
- invite creation rejects malformed email/role and globally registered identities;
- create/reissue stores only a hash but returns the raw token once;
- old token no longer resolves after reissue;
- public lookup hashes its URL token;
- invite registration uses the invite email, ignores identity override attempts, creates no mailbox/routing rule, and consumes the invite;
- invalid/expired/replayed invitations fail;
- ordinary first-run and primary-domain registration behavior remains covered.

### Browser

- invite dialog shows the one-time link after creation;
- pending invite rows no longer have Copy Link;
- invite registration displays the fixed invited email and no username/domain control;
- successful invited registration reaches Inbox with no mailbox until assigned.

### Full verification

- `npm run verify`;
- `npm run e2e`;
- `npx opennextjs-cloudflare build`;
- production pending-invite count before deployment;
- production invite → register → assign mailbox → login flow.

## 7. Decisions

- Approved 2026-07-23: invited external email is the login identity.
- Approved 2026-07-23: invite acceptance creates no mailbox; mailbox access remains an explicit admin assignment.
- Approved 2026-07-23: copy-link delivery remains the F49 MVP boundary.
- Decision: invitation tokens use the same SHA-256 at-rest pattern as password-reset tokens.
- Decision: Lumimail rejects already-registered invite identities until multi-organization switching is specified.
- Decision: legacy plaintext invitation links are invalidated rather than supported through a plaintext fallback.

## 8. Bug / change log draft

### 2026-07-23 — Bind invitations to account identity

Type: Security / Correctness / UX

Summary:

- Store only invitation-token hashes, reveal new links once, bind registration to the invited external address, and stop invite acceptance from creating a mailbox.

Reason:

- The current link grants organization access to an identity chosen by the link holder and conflates workspace membership with receiving-address provisioning.

Impact:

- Invited users receive a login account only; administrators intentionally assign the mailboxes they should read or answer.

## 9. Implementation and verification log

### 2026-07-23 — Local implementation

- Added SHA-256 invitation-token hashing while retaining the existing D1 column, so raw link tokens are never stored.
- Pending member listings omit tokens; the create/reissue response reveals the new link secret once.
- Invite creation validates normalized email and explicit organization role and rejects identities already registered anywhere in the current one-organization account model.
- Public lookup hashes the presented token, and reissuing an invitation immediately invalidates its prior link.
- Invite registration displays the fixed external identity, sends no client-selected username, and creates only the user and organization membership.
- Acceptance conditionally deletes the exact unexpired hashed invitation before batching the user and membership writes; replay loses the claim, and a failed batch restores the hashed invitation.
- Invite acceptance performs no workspace-domain lookup, mailbox insertion, Cloudflare API call, or Email Routing provisioning.
- Fixed the one-time-link dialog contract so the canonical nested response is read correctly and the dialog remains open until the administrator copies or closes it.
- Tightened a pre-existing catch-all E2E locator to its routing-rule list item after the full-concurrency run exposed two legitimate `*` elements.
- Production inspection found 0 unexpired legacy invitation rows, so F49 will invalidate no active production links.
- `npm run verify` passed with 127 test files, 1,065 tests, and 100% statements, branches, functions, and lines; lint reported 37 warnings and zero errors.
- `npx playwright test --workers=2` passed all 30 browser scenarios.
- `npx opennextjs-cloudflare build` completed and generated `.open-next/worker.js`.

Production deployment and a controlled invite/register/assign/login flow remain pending.
