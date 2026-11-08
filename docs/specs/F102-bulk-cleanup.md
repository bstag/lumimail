# F102 — Bulk cleanup

> Status: In Progress
> Owner area: `src/app/api/messages/bulk/*`, `src/lib/messages/list-conditions.ts`, `src/components/messages/message-folder-page.tsx`, `src/components/messages/bulk-cleanup*.tsx`

## 1. Problem & User Job

Selecting a page of 25 messages at a time does not dent a backlog of thousands. A reader
needs to act on everything a view shows, and to clear out old mail by age in one step.

## 2. User Stories & Acceptance Criteria

- When every message on the page is selected and the view holds more, a bar offers
  **Select all N in this view**; bulk actions then apply to every message matching the
  view's query (folder, Focused/Other, search, read filter, label), not only loaded rows.
- The Inbox offers **Clean up**: archive mail older than 7, 30, or 90 days in the current
  Inbox view (Focused, Other, or all), showing how many messages that is before confirming.
- When the Other tab holds more than 200 messages older than a week, a dismissible prompt
  offers to archive them.
- Query-based bulk actions use the same conditions as the list (one builder), never touch
  mail the reader cannot access, and report how many messages changed.

## 3. Scope Boundaries

**In scope:** query-scoped bulk actions, archive-by-age with preview, Other backlog prompt.
**Out of scope:** undo; background jobs for very large sets (a single D1 statement is used).

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/messages/bulk` | session/API key | `{ action, messageIds }` or `{ action, query, preview? }`; `query` takes list params plus `olderThanDays` | `{ ok, updated }` (`{ matched }` for preview) | 400 invalid action/query |

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| SQLite | `tests/unit/app/api/messages/bulk-query.sqlite.test.ts` | query scope, age, focus, preview, cross-tenant denial |
| Unit | `tests/unit/components/messages/bulk-cleanup*.test.ts*` | view query, age menu, prompt, select-all bar and reset |
| E2E | `tests/e2e/inbox-cleanup.spec.ts` | select all in view, clean up by age |

## 10. Change Log

### 2026-11-08 — Initial implementation

- List filtering moved into `messageListConditions`, shared by `/api/messages`,
  query-scoped bulk actions, and `/api/messages/senders` (F103); adds `olderThanDays` and
  `sender` parameters.
- "All in this view" resets when the page stops being fully selected or the view changes, so
  reselecting a page never silently widens the selection.
- Query-scoped updates are one D1 statement after a count; at current mailbox sizes (~10k
  inbound) this is within limits. Revisit with batched updates if a view grows far larger.
