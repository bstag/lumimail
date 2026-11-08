# F100 — Snooze

> Status: In Progress
> Owner area: `src/app/api/messages/[messageId]/snooze/route.ts`, `src/app/api/messages/route.ts`, `src/app/api/messages/counts/*`, `src/components/message-actions/*`, `src/app/(dashboard)/snoozed/page.tsx`

## 1. Problem & User Job

Some mail needs action later, not now. Leaving it in the Inbox keeps it in the way; archiving
it risks forgetting it. A reader needs to hide a message until a chosen time and have it
come back where they will see it.

## 2. User Stories & Acceptance Criteria

- A received message's toolbar offers **Snooze**: Later today (3 hours, on the hour), Tomorrow
  morning (08:00 local), Next week (Monday 08:00 local); a snoozed message also offers Unsnooze.
- While snoozed, the message is absent from the Inbox, Focused/Other, and Inbox counts, and
  appears in a **Snoozed** folder ordered by wake time.
- When the time passes, it is back in the Inbox, unread (snoozing marks it unread), sorted by
  its wake time so it appears at the top. No scheduler is needed; visibility is computed.
- Only inbound received mail the user can read can be snoozed (cross-tenant denial); wake
  times must be in the future and within a year.
- Snooze times in other folders (e.g. archived later) never hide or reorder that mail.

## 3. Scope Boundaries

**In scope:** snooze/unsnooze, Snoozed folder, Inbox filtering, ordering, and counts.
**Out of scope:** custom date picker; "remind me if no reply" follow-ups (needs outbound
reply tracking); push notification on wake.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | `snoozed_until` | migration `0047_message_snooze.sql`, partial index where not null; kept after waking for ordering |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/messages/[messageId]/snooze` | session/API key | `{ until: ISO-8601 \| null }` | `{ snoozedUntil }` | 400 invalid/past/>1 year, 401, 404 not found / not received |
| GET | `/api/messages?snoozed=true` | session/API key | with Inbox params | sleeping mail, soonest first | — |

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| SQLite | `tests/unit/app/api/messages/snooze-list.sqlite.test.ts` | hidden/visible, woken first, Snoozed view, other folders untouched, route validation, cross-tenant denial |
| Unit | `tests/unit/app/api/messages/counts/utils.test.ts` | sleeping mail excluded from Inbox counts |
| Unit | `tests/unit/components/message-actions/*.test.ts` | presets, client request |
| E2E | `tests/e2e/snooze.spec.ts` | toolbar snooze to Snoozed folder |

Performance note: Inbox ordering by wake-or-created time cannot use the
`messages_mailbox_created_idx` ordering; acceptable at current mailbox sizes, revisit with a
stored sort key if lists grow large.

## 10. Change Log

### 2026-11-07 — Initial implementation
