# F97 — Focused / Other inbox

> Status: In Progress
> Owner area: `src/lib/messages/focus.ts`, `src/app/api/messages/route.ts`, `src/components/messages/message-folder-page.tsx`

## 1. Problem & User Job

About 60% of received mail is tagged Promotions or Newsletters, and only a handful is
Personal or Needs reply (F95 insights, 30 days, 4,422 messages). A mailbox owner needs
the mail from people and the mail that needs action to stop competing with bulk mail.

## 2. User Stories & Acceptance Criteria

- As a reader, the Inbox has **Focused** and **Other** tabs; my choice is remembered on
  this device and Focused is the default.
- Other contains received mail carrying a bulk tag (Promotions, Newsletters, Updates)
  and no priority tag (Personal, Needs reply), and that I have not starred.
- Focused contains everything else, including untagged mail, so nothing disappears
  while categorization is off or still processing.
- Tags match by label name, case-insensitively, among the reader's own labels only.
- The label chips still narrow whichever tab is active.

## 3. Scope Boundaries

**In scope:** list API `focus` filter, Inbox tabs.
**Out of scope:** per-user configuration of which tags count as bulk; unread counts per tab.

## 4. Data Model

No schema change. Reads `labels.name` and `message_labels`.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/messages` | session/API key | optional `focus=focused\|other` | unchanged list envelope | 400 invalid `focus` |

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Route (SQLite) | `tests/unit/app/api/messages/focus.sqlite.test.ts` | partition, priority/starred override, other users' labels ignored, validation |
| Unit | `tests/unit/hooks/utils.test.ts` | `focus` reaches the query string |

## 8. Current Behavior

Inbox lists all received mail in one stream; chips filter by one label at a time.

## 10. Change Log

### 2026-11-07 — Initial implementation

### 2026-11-07 — Correspondents stay Focused

Received mail from an address the user has sent single-recipient mail to stays in Focused
even when bulk-tagged (F99).
