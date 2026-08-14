# F09 — Settings & Profile

> Status: Shipped
> Owner area: `src/app/api/settings/`, `src/app/(settings)/settings/`

## 1. Problem & User Job

Users need to manage their personal profile (name, recovery email) and view mailbox settings.
Settings are personal — not org-scoped.

## 2. User Stories & Acceptance Criteria

- As a user, I can update my display name and recovery email.
- As a user, I can view my account email (read-only).
- As a user, I can view and update my selected mailbox's display name.

## 3. Scope Boundaries

**In scope:** Profile update (name + resetEmail), mailbox display name update.

**Out of scope:** Password change, email change, notification preferences, theme toggle.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `users` | `name`, `resetEmail` | via `/api/settings/profile` |
| `mailboxes` | `displayName` | via `/api/mailboxes/[id]` |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| PATCH | `/api/settings/profile` | `guardUser` | `{ name, resetEmail? }` | `{ ok }` | 401, 400 |

## 6. UI/UX

- `/settings` — two cards: Profile card (name input, recovery email input, save button) + Mailbox card (display name, read-only email/domain)
- Saved confirmation appears inline in the button

## 7. Current Behavior

- Profile update validates via `updateProfileSchema`
- `resetEmail` accepts empty string → converted to null
- Mailbox settings page at `/mailboxes/[id]` also updates display name
- No confirmation toast — button text changes to "Saved" briefly

## 8. Bug / Change Log

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.
