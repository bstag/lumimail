# F98 — Sender cleanup: unsubscribe and archive all

> Status: In Progress
> Owner area: `src/lib/categorization/sender-actions.ts`, `src/app/api/insights/senders/*`, `src/app/(dashboard)/insights/page.tsx`, `src/lib/email/parse.ts`, `src/lib/email/message-filters.ts`

## 1. Problem & User Job

Mail insights ranks senders by volume (GitHub 156, Bible Study Tools 111, Amazon 100 per
month), but the only action was drafting a classification rule. A mailbox owner needs to
stop unwanted mail at the source or file a sender's mail away in one step.

## 2. User Stories & Acceptance Criteria

- Each sender row in Mail insights offers **Unsubscribe** and **Archive all**.
- Unsubscribe uses the newest message from that sender carrying `List-Unsubscribe`.
  - With an https target and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`
    (RFC 8058), the Worker POSTs `List-Unsubscribe=One-Click` and reports success or failure.
  - Otherwise the https link, or failing that the mailto target, opens for the reader.
  - Without targets, the reader is told the sender offers no option.
- Archive all moves the sender's received inbound mail to Archive and creates one
  "Auto-archive <sender>" message filter (not duplicated on repeat).
- Message filters now run on imported (Gmail/Outlook) received mail as well as native
  inbound mail, and match case-insensitively.
- Only mail the user can read is considered (cross-tenant denial).

## 3. Scope Boundaries

**In scope:** header capture at ingest and in the F89 body repair, the two actions, filter
application to imports.
**Out of scope:** sending unsubscribe emails automatically for mailto-only senders;
backfilling `List-Unsubscribe` for imports that are not otherwise repaired.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | `unsubscribe_url`, `unsubscribe_mailto`, `unsubscribe_one_click` | migration `0046_message_unsubscribe.sql` |
| `message_filters` | insert | one auto-archive filter per sender |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/insights/senders/unsubscribe` | session/API key | `{ sender, mailboxId? }` | `{ method: "one_click", ok } \| { method: "link"\|"mailto", url } \| { method: "none" }` | 400, 401 |
| POST | `/api/insights/senders/archive` | session/API key | `{ sender, mailboxId?, createFilter = true }` | `{ archived, filterId }` | 400, 401 |

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/email/parse.test.ts` | header parsing, https/mailto only |
| SQLite | `tests/unit/lib/categorization/sender-actions.sqlite.test.ts` | one-click, link, mailto, none, archive + filter, cross-tenant denial |
| Route | `tests/unit/app/api/insights/sender-actions.test.ts` | auth, validation |
| Unit | `tests/unit/lib/email/message-filters.test.ts`, `external/sync-page.test.ts`, `import-message.test.ts` | case-insensitive filters, filters on imports |
| Component | `tests/unit/components/mail-insights.test.tsx` | buttons and outcomes |

## 8. Current Behavior

`List-Unsubscribe` was discarded; filters ran only on native inbound mail, case-sensitively.

## 10. Change Log

### 2026-11-07 — Initial implementation
