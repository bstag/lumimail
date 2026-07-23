# F51 — Restricted-Member Admin Navigation

> Status: Shipped
> Remediation: UI authorization follow-up discovered during F49 production validation

## 1. Current behavior

- Organization administration APIs use `guardOrgAdmin` and return `403` to a member.
- The dashboard mailbox selector always renders an **Admin settings** link.
- The entire `(admin)` layout renders `AdminNav` for any authenticated user with a mailbox.
- Client pages do not interpret admin-query `403` responses consistently, so a restricted member can see controls such as **New mailbox** even though the mutation endpoint rejects them.
- Controlled production validation confirmed that a member with responder access to one mailbox could open `/mailboxes`; no organization inventory was returned, but the admin navigation and creation control were visible.

## 2. Desired behavior

- `/api/auth/me` exposes the authenticated user's organization role.
- Owner and admin users retain the existing organization administration navigation and routes.
- Member users do not see **Admin settings** or any organization administration navigation.
- Direct navigation by a member to an `(admin)` route redirects to `/inbox` before rendering administrative controls.
- API authorization remains authoritative and continues returning `403` for forbidden administration requests.

## 3. Security invariants

- Client-side hiding and redirects must never replace `guardOrgAdmin`.
- A stale role from a previous browser identity must not grant visible admin navigation after an account switch.
- Mailbox roles (`viewer`, `responder`, `manager`) do not imply organization admin authority.
- An organization `member` with mailbox-manager access still cannot administer domains, organization members, API keys, routing, aliases, webhooks, or organization mailbox inventory.

## 4. Edge cases and error states

- While the session/role check is loading, do not flash administrative navigation or page controls.
- A missing or unknown role is treated as non-admin in the client.
- A `401` keeps the existing session-expiration behavior.
- A direct member visit must be redirected before admin page queries or controls mount.
- Owner-to-member and member-to-owner browser switches must use the F50 account-state reset path.

## 5. Test plan

### Unit

- `/api/auth/me` returns the organization role without changing its existing identity fields.
- Admin-role helpers accept only `owner` and `admin`.
- Unknown, missing, and mailbox-only roles fail closed as non-admin.

### Browser

- A member sees no **Admin settings** entry in the mailbox selector.
- Direct member navigation to `/admin`, `/members`, `/mailboxes`, `/domains`, `/api-keys`, `/aliases`, `/routing`, and `/webhooks` redirects to `/inbox`.
- A member never sees **New mailbox** during the redirect.
- An admin retains the full navigation and can open the mailbox administration page.

### Verification

- `npm run verify`
- `npm run e2e`
- `npx opennextjs-cloudflare build`
- controlled production member/admin navigation checks without hard refresh

## 6. Decisions

- Decision 2026-07-23: classify this as a UI authorization defect, not a server-side authorization bypass; the tested administration API returned `403`.
- Decision: use organization role for organization navigation and mailbox role only for mailbox content/actions.
- Decision: default the client to non-admin until the current session role is known.

## 7. Bug / change log draft

### 2026-07-23 — Hide server-forbidden administration from members

Type: Authorization UX / Defense in depth

Summary:

- Make organization role available to the authenticated client, hide administration navigation from members, and redirect direct member visits before admin controls render.

Reason:

- Production invitation validation showed server-forbidden administration links and controls to a restricted organization member.

Impact:

- Restricted users see only actions they can actually perform, while server guards continue enforcing the security boundary.

## 8. Implementation and verification log

### 2026-07-23 — Local implementation

- Added a single organization-role helper that grants client administration only to `owner` and `admin`.
- Added the current organization role to `/api/auth/me` without changing the existing identity or mailbox-state fields.
- Authenticated layouts now provide the current session to descendant navigation.
- The mailbox selector renders **Admin settings** only for an owner or admin and fails closed when role data is missing or malformed.
- The entire `(admin)` layout requires an owner/admin role and redirects a member to `/inbox` before admin navigation, queries, or controls render.
- Existing server-side `guardOrgAdmin` checks were left unchanged.
- Added unit coverage for accepted/rejected organization roles and the session response contract.
- Added browser coverage for all eight administration entry routes, member navigation visibility, retained owner access, and an owner-to-member account switch without a hard refresh.
- `npm run verify` passed with 131 test files, 1,081 tests, 100% statements, branches, functions, and lines, and 37 existing lint warnings with zero errors.
- All 33 Chromium scenarios reported passing. The Playwright command then remained open until timeout because the known local Wrangler remote-proxy helper could not initialize or stop cleanly in the sandboxed non-interactive process.
- The escalated OpenNext Cloudflare production build completed successfully and generated `.open-next/worker.js`.

### 2026-07-23 — Production deployment and controlled validation

- Committed the verified implementation as `2dad399`.
- Deployed Worker version `8ac50a92-ae5e-4ae0-8d93-3100390a500a`.
- Production smoke checks passed: `/` returned `200`, and unauthenticated `/api/admin/mailboxes` returned `401`.
- After one normal reload to load the newly deployed JavaScript bundle, the existing `support@lucidkith.org` member session no longer showed **Admin settings**.
- Direct member navigation to `/mailboxes` rendered no **New mailbox** control and redirected to `/inbox`.
- Without a hard refresh, the browser logged out and signed in as the owner. **Admin settings** immediately appeared, `/mailboxes` remained accessible, and **New mailbox** was visible.

F51 is production-validated and complete.
