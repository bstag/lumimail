# F99 — Other digest and correspondent triage

> Status: In Progress
> Owner area: `src/app/api/messages/digest/route.ts`, `src/components/messages/other-digest.tsx`, `src/lib/messages/focus.ts`

## 1. Problem & User Job

Once bulk mail moves to Other (F97), a reader still needs to skim it quickly and clear it in
one step, and must not lose mail from real people that a classifier tagged as bulk.

## 2. User Stories & Acceptance Criteria

- At the top of the Other tab (first page, no search), a "Last 24 hours in Other" panel shows
  how many bulk messages arrived from how many senders, one line per sender (newest subject,
  count, unread emphasis), up to 20 senders, each linking to its newest message.
- "Mark all read" marks the window's unread Other mail read, in batches of 80 IDs (D1 binds
  each ID; about 100 parameters per statement).
- Received mail from an address this user has sent mail to (single-recipient sent messages)
  always stays in Focused, even when bulk-tagged.
- Only mail the user can read is summarized (cross-tenant denial).

## 3. Scope Boundaries

**In scope:** grouping, mark-all-read, correspondent override.
**Out of scope:** AI-written summaries and receipt/package extraction. As used here, Jev
(TypeSafe) is a classifier; summarization and field extraction need a verified provider
capability and a consent review before they can be built.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/messages/digest` | session/API key | optional `mailboxId` | `{ total, senderCount, senders[≤20], unreadIds[≤500] }` | 401 |

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| SQLite | `tests/unit/app/api/messages/digest.sqlite.test.ts` | window, grouping, newest subject, unread IDs, mailbox scope, cross-tenant denial |
| SQLite | `tests/unit/app/api/messages/focus.sqlite.test.ts` | correspondent override, recipient lists skipped |
| Unit | `tests/unit/components/messages/other-digest-utils.test.ts` | D1-safe batching |
| E2E | `tests/e2e/focused-inbox.spec.ts` | panel content and mark-all-read |

## 10. Change Log

### 2026-11-07 — Initial implementation
