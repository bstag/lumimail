# F51 — Restricted-Member Admin Navigation

> Status: Specified — Implementation Pending
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
- A `403` from an admin query must not be parsed as successful empty data.
- Owner-to-member and member-to-owner browser switches must use the F50 account-state reset path.

## 5. Test plan

### Unit

- `/api/auth/me` returns the organization role without changing its existing identity fields.
- Admin-role helpers accept only `owner` and `admin`.
- Admin query clients reject `403` responses instead of treating them as empty success.

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
