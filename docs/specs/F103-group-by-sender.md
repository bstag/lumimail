# F103 — Group by sender

> Status: In Progress
> Owner area: `src/app/api/messages/senders/route.ts`, `src/components/messages/sender-groups*.tsx`, `src/components/messages/message-folder-page.tsx`

## 1. Problem & User Job

Bulk mail arrives as dozens of messages from the same few senders. A flat list makes the
reader scroll past the same sender again and again. As an option, the Inbox can show one row
per sender, so a whole sender can be read, archived, or filtered at once.

## 2. User Stories & Acceptance Criteria

- The Inbox has a **Group by sender** toggle, remembered on this device; it is off by default.
- When on, the current Inbox view (Focused, Other, or all) lists one row per sender address:
  display name, message count, unread count, latest subject and date, newest first.
- A sender row expands to show that sender's messages in the view (linking to each message).
- Each row offers **Archive all** (query-scoped bulk action, F102) and **Filter** (opens the
  filter form prefilled with the address, F101).
- Grouping only counts mail the reader can read; snoozed mail stays hidden.

## 3. Scope Boundaries

**In scope:** sender grouping for the Inbox views, expand, archive all, filter.
**Out of scope:** grouping other folders; category bundles; conversation rows.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/messages/senders` | session/API key | list params, `limit`, `offset` | `{ senders: [{ sender, fromAddr, count, unread, latestId, latestSubject, latestAt }], total }` | 400 invalid params |

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| SQLite | `tests/unit/app/api/messages/senders.sqlite.test.ts` | grouping, counts, order, focus, cross-tenant denial |
| Unit | `tests/unit/components/messages/bulk-cleanup*.test.ts*` | toggle storage, rows, expand, archive all, paging |
| E2E | `tests/e2e/inbox-cleanup.spec.ts` | toggle, expand, archive a sender, remembered choice |

## 10. Change Log

### 2026-11-08 — Initial implementation

- Groups use SQLite's bare-column behaviour with `max(created_at)` for the newest message,
  as the F99 digest does. The page grows by 25 senders up to 500.
