# F03 — Mailboxes

> Status: Shipped
> Owner area: `src/app/api/mailboxes/*`, `src/app/(settings)/(org)/mailboxes/`, `src/components/mailbox-selector.tsx`

## 1. Problem & User Job

Users need email addresses to send and receive mail. Mailboxes represent `localPart@domain` addresses tied to Cloudflare Email Routing rules.

## 2. User Stories & Acceptance Criteria

- As an admin, I can create mailboxes on my verified domains.
  - Given I select a domain, enter a local part, when I submit, a Cloudflare routing rule is created and the mailbox appears in the list.
- As an admin, I can view and edit a mailbox's display name.
  - Given I open mailbox settings, when I change the name and save, the display name updates.
- As any user, I can select which mailbox to send from (mailbox selector).
  - The mailbox selector shows all my mailboxes with the `isPrimary` flag for the one matching my user email.

## 3. Scope Boundaries

**In scope:** Create mailbox (with Cloudflare routing rule), list mailboxes, view single mailbox, update display name.

**Out of scope:** Delete mailbox (no DELETE route), change localPart/domain (immutable), mailbox forwarding.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `mailboxes` | `id`, `userId`, `organizationId`, `domainId`, `localPart`, `displayName` | |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/mailboxes` | `guardUser` | — | `{ mailboxes[] }` | 401 |
| POST | `/api/mailboxes` | `guardUser` | `{ domainId, localPart, displayName? }` | `{ id, address }` | 400, 404 (domain not found), 409 (duplicate), 502 (Cloudflare error) |
| GET | `/api/mailboxes/[id]` | `guardUser` | — | `{ mailbox }` | 401, 404 |
| PATCH | `/api/mailboxes/[id]` | `guardUser` | `{ displayName }` | `{ ok }` | 401, 404 |

## 6. UI/UX

- `/mailboxes` — card grid with address and display name
- `/mailboxes/[id]` — settings page: display name input + save button, address card (read-only)
- Mailbox selector in top bar: dropdown of all user mailboxes, primary badge
- Empty state: "No mailboxes yet"

## 7. Current Behavior

- `GET /api/mailboxes` scoped by `userId`, joined with domains for `hostname`
- `POST` validates domain ownership (checks `domain.userId === user.id`)
- `PATCH` only updates `displayName`
- No `DELETE` route exists — mailboxes can't be removed via API or UI

## 8. Known Gaps

- No delete mailbox (blocker for workspace admin)
- Scoped by `userId`, not `organizationId` (to be changed in F12)

## 9. Bug / Change Log

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.
