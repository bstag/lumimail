# F101 — Filters at scale

> Status: In Progress
> Owner area: `src/lib/email/message-filters.ts`, `src/lib/email/filter-condition.ts`, `src/app/api/filters/*`, `src/app/(dashboard)/filters/*`, `src/lib/email/message-expiry.ts`, `src/lib/messages/focus.ts`

## 1. Problem & User Job

A mailbox with thousands of messages, most of them bulk mail, cannot be organized one
message at a time. Filters (F24) existed but only matched one substring per field with AND,
only searched subject and sender for "has words", only affected mail arriving after the
filter was saved, and could not keep mail out of Focused or clean it up later. A reader
needs to write one rule and have it apply to the backlog and to future mail.

## 2. User Stories & Acceptance Criteria

- A filter field accepts several alternatives separated by commas (`amazon.com, ebay.com`);
  any alternative matches. Matching is case-insensitive substring matching, as before.
- A filter matches when **all** conditions match (default) or when **any** condition matches.
- "Has words" also searches the snippet and the plain-text body.
- A filter must have at least one condition; a condition-less filter is rejected (it used to
  match every message).
- New actions: **Show in** Focused or Other (overrides the F97 split for that mail), and
  **Delete after N days** (1–365): matched mail moves to Trash N days after it arrived.
- **Apply to existing mail**: from the filter list, the reader sees how many existing inbound
  messages (Inbox or Archive) match, and can apply the filter's actions to all of them.
  Applying is idempotent. Only mail the reader can access (the same rule as bulk actions) is counted or changed.
- **Filter messages like this**: a message's toolbar opens the filter form prefilled with its
  sender address.
- The same matching rule decides new mail and existing mail (one SQL condition).
- Expiry runs in the scheduled worker: expired Inbox/Archive mail moves to Trash.

## 3. Scope Boundaries

**In scope:** any-of matching, comma alternatives, body search, focus override, expiry,
apply-to-existing with preview count, prefill from a message.
**Out of scope:** regular expressions; snooze as a filter action; editing an existing
filter in place (delete and recreate); running filters on outbound mail.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `message_filters` | `match_mode` ('all'\|'any'), `action_focus` ('focused'\|'other'\|null), `action_expire_days` | migration `0048_filters_at_scale.sql` |
| `messages` | `focus_override`, `expires_at` | partial index on `expires_at` where not null |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/filters` | session/API key | adds `matchMode`, `actionFocus`, `actionExpireDays` | `{ id }` | 400 no condition / invalid |
| GET | `/api/filters/[id]/apply` | session/API key | — | `{ matched }` | 404 not owner |
| POST | `/api/filters/[id]/apply` | session/API key | — | `{ matched }` | 404 not owner |

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| SQLite | `tests/unit/lib/email/message-filters.sqlite.test.ts` | alternatives, all/any, body search, empty filter, chunking, new-mail apply, focus override, expiry stamp, apply-to-existing, expiry run |
| SQLite | `tests/unit/app/api/filters/apply.sqlite.test.ts` | preview count, apply actions, idempotence, cross-tenant denial |
| SQLite | `tests/unit/app/api/messages/focus.sqlite.test.ts` | focus override wins |
| Unit | `tests/unit/app/api/filters/route.test.ts`, `tests/unit/app/dashboard/filters/*` | validation, describe, form fields, apply flow, prefill |
| E2E | `tests/e2e/inbox-cleanup.spec.ts` | create from message, preview and apply |

## 10. Change Log

### 2026-11-08 — Initial implementation

- Matching moved into one SQL condition (`filter-condition.ts`) used by ingest and by
  apply-to-existing; `instr()` keeps `%` and `_` literal. Ingest evaluates filters in chunks
  that stay under D1's bound-parameter limit (at most 10 alternatives per field).
- Condition-less filters are rejected at creation and match nothing if one already exists;
  the filter list labels them. The old form's "Conditions (messages matching any)" heading was
  wrong (matching was AND); the form now has an explicit all/any choice.
- Expiry counts from arrival for existing mail, so applying "delete after 7 days" to old mail
  trashes it on the next scheduled run; the preview count is shown before applying.
- A just-created filter previews its backlog match count automatically.
