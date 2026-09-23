# F04 — Mail Folders (Inbox, Sent, Drafts, Archive, Spam, Trash)

> Status: Shipped
> Owner area: `src/app/api/messages/*`, `src/app/(dashboard)/{inbox,sent,drafts,archive,spam,trash}/`

## 1. Problem & User Job

Users need to browse, read, and manage email in standard folder organization.
Messages flow through inbox → read → archived/spam/trash just like any email client.

## 2. User Stories & Acceptance Criteria

- As a user, I can view messages in my inbox, sent, drafts, archive, spam, and trash folders.
  - Each folder filters by status + direction (e.g., inbox = inbound + received, sent = outbound + sent).
- As a user, I can read a message and see its full content.
- As a user, I can bulk select messages and move them to spam or trash.
- As a user, I can mark messages as read/unread.
- As a user, every message-moving action I can perform has a destination I can
  navigate to. Archiving is reversible: archived mail is listed at `/archive` and
  can be moved back to the inbox.
  - Archive holds `status = "archived"` in either direction; inbound and outbound
    archived mail appear in the same list.
  - Back-navigation from an archived message's detail view returns to `/archive`,
    not to the inbox it left.

## 3. Scope Boundaries

**In scope:** Folder listing with pagination, message detail view, bulk move to
archive/spam/trash and back to inbox, mark read/unread.

**Out of scope:** Labels (see F15/F23), user-created folders, message threading
(see F58).

> **Resolved contradiction (2026-07-31).** This section previously listed
> "archiving (non-Gmail style)" as out of scope while `actionArchive` (filters),
> `MessageActions`, and `BulkMessageToolbar` all shipped an archive action. The
> implementation was the intent and the boundary was stale; archiving is in scope
> and the exclusion is withdrawn. See the Bug/Change Log entry below.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | `id`, `userId`, `organizationId`, `mailboxId`, `direction`, `status`, `read`, `fromAddr`, `toAddr`, `subject`, `snippet`, `threadId`, `createdAt` | |
| `messageBodies` | `textBody`, `htmlBody` | joined for message detail |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/messages` | `getCurrentUser` | query: `mailboxId`, `direction`, `status`, `after?`, `limit?`, `offset?` | `{ messages[], total, limit, offset }` | 400 invalid status/pagination, 401 |
| GET | `/api/messages/[messageId]` | `getCurrentUser` | — | `{ message }` + body | 401, 404 |
| POST | `/api/messages/bulk` | `guardUser` | `{ messageIds[], status }` | `{ ok }` | 401, 400 |
| GET | `/api/messages/counts` | `getCurrentUser` | query: `mailboxId` | `{ inbox, sent, drafts, archived, spam, trash, starred }` | 401 |
| POST | `/api/messages/[messageId]/read` | `guardUser` | — | `{ ok }` | 401, 404 |

`GET /api/messages` already accepted `status=archived` before the Archive folder
existed; no API change was required to list archived mail. `POST
/api/messages/bulk` already accepted `action: "inbox"` (→ `status = "received"`),
which is what un-archiving uses.

## 6. UI/UX

- Sidebar nav: Inbox, Sent, Drafts, Starred, Archive, Spam, Trash with unread counts
- Archive uses the shared `MessageFolderPage`; rows link to `/inbox/[messageId]`
  (the shared detail route), as Starred does
- The "Move to" selector on both the bulk toolbar and the message detail toolbar
  offers Inbox, Spam, and Trash. Inbox is what makes archive/spam/trash reversible
- Message list: checkbox, sender, subject, snippet, date
- Message detail: full headers, HTML body (sanitized via DOMPurify)
- Bulk toolbar appears when messages selected
- Empty state per folder: "No emails in {folder}"

## 7. Current Behavior

- All message queries scoped by `userId`
- Inbound email parsed via `postal-mime`, stored with text and HTML bodies
- HTML rendered via `dangerouslySetInnerHTML` after `DOMPurify.sanitize()`
- Bulk operations guarded: `eq(messages.userId, user.id)` in WHERE clause
- `GET /api/messages` derives `limit` and `offset` with unvalidated numeric
  coercion. Negative, non-finite, or fractional values can reach Drizzle's
  `LIMIT`/`OFFSET` builder, where an invalid limit may omit the SQL `LIMIT`.
- Label filtering first materializes every matching message id into a JavaScript
  array and then builds an `IN` predicate from that array.
- Thread counts use one aggregate query containing every thread id returned by
  the page. A full page of 100 distinct threads exceeds D1's 100 bound-parameter
  limit once the mailbox access predicate is included.

## 7a. Message-listing query safety

The message-listing route keeps its existing response shape and authorization
rules while enforcing bounded query inputs and database parameters:

- An omitted `limit` remains 50. A supplied `limit` must be a finite positive
  integer; valid values above 100 are capped at 100. Invalid values return a
  400 response without querying messages.
- An omitted `offset` remains 0. A supplied `offset` must be a finite
  nonnegative integer. Invalid values return a 400 response without querying
  messages.
- `labelId` is applied with a user-scoped SQL subquery so matching ids stay in
  D1 and are never materialized into an unbounded `IN` array.
- Thread-count aggregation is split into bounded batches. Every batch retains
  the same `messageAccessCondition`, including its draft send-capability rule,
  and stays below D1's 100 bound-parameter limit.

## 7b. Edge Cases and Error States

| Case | Behavior |
|------|----------|
| Archive folder empty | "No archived emails" empty state, same as other folders |
| Archived outbound message | Listed in Archive alongside inbound; badge shows direction |
| Un-archive (`action: "inbox"`) on an outbound message | Status becomes `received`, which is an inbound-shaped status. Accepted as pre-existing bulk-action behavior; documented under Decisions rather than changed here |
| Archived message opened directly by URL | Detail view renders; back link resolves to `/archive` |
| Message archived while the Archive list is open | Shared mutation invalidation (F72) refetches the list |
| Restricted member | Archive reads go through the same `messageAccessCondition` as every other folder; no new access path |
| Mobile | Archive is not in `MOBILE_TAB_PRIORITY` (the bar holds four); reachable from the full nav |
| Invalid `limit` (`0`, negative, fractional, non-finite, or non-numeric) | 400 `Invalid limit`; no message query is executed |
| `limit` above 100 | Accepted and returned as `limit: 100` |
| Invalid `offset` (negative, fractional, non-finite, or non-numeric) | 400 `Invalid offset`; no message query is executed |
| Label with many messages | Label membership is evaluated inside D1; the route does not build one bound parameter per matching message |
| Page with 81–100 distinct threads | Thread counts use multiple bounded aggregate queries, each retaining mailbox and draft access predicates |

## 7c. Test Plan

`tests/unit/app/api/messages/route.test.ts` covers invalid pagination values and
the 100-item limit cap, while
`tests/unit/app/api/messages/route.sqlite.test.ts` executes the real Drizzle
queries against SQLite with 101 labelled messages and 100 distinct threads. It
verifies label filtering stays a user-scoped subquery, every emitted statement
has at most 100 bound parameters, and thread aggregation is split into bounded
batches. Existing access, draft, label, thread-count, response-shape, and
empty-result cases remain covered.

## 8. Decisions

- **Archive is a status, not a folder row.** `messages.status` is single-valued,
  so "archived" is mutually exclusive with inbox/spam/trash — consistent with the
  other folders. Non-exclusive grouping is labels (F15/F23), not this.
- **Un-archive targets `received`.** Reusing the existing `inbox` bulk action
  avoided inventing a second status-restore path. For an outbound archived
  message this sets an inbound-shaped status; the message then lists under Inbox
  rather than Sent. Left as-is because it is the pre-existing behavior of the
  `inbox` action and changing it is a separate concern from reachability.

## 9. Bug / Change Log

### 2026-07-31 — Archived mail was unreachable

Type: Bug Fix

Summary:
- Added the `/archive` folder page, its sidebar entry, its `archived` folder
  count, and `archived` as a `MessageFolder`.
- Added "Move to Inbox" to the bulk and detail "Move to" selectors.
- `getMessageBackHref` now resolves `status = "archived"` to `/archive`.

Reason:
- Three shipped controls wrote `status = "archived"`: the `actionArchive` filter
  action, `MessageActions`, and `BulkMessageToolbar`. Nothing read it back.
  `MessageFolder` had no `archived` member, `getMessageQueryParams` never
  requested that status, no route listed it, and `getMessageFolder` returned
  `null` for it so it was not even counted. Expected: archived mail is listed
  somewhere. Actual: archiving removed a message from every view in the product
  with no way to reach it again.

Root cause:
- The archive *write* path was built (F04 bulk actions, F-filters) without the
  matching *read* path. The spec's own scope boundary excluded archiving, so the
  gap was never contradicted by the document either.

Impact:
- Any user who archived a message, or wrote a filter with "Archive" checked, lost
  access to that mail through the UI. Data was never deleted — the rows were
  intact and reachable via `GET /api/messages?status=archived` — so this is a
  recovery, not a restore.

Tests:
- `tests/unit/app/api/messages/counts/utils.test.ts` — archived rows count into
  the `archived` folder bucket
- `tests/unit/components/messages/archive-folder.test.ts` — folder query params,
  back-href resolution, refetch cadence
- `tests/e2e/archive-folder.spec.ts` — Archive nav entry, list rendering, empty
  state, and un-archiving back to the inbox

Notes:
- No schema or API change was needed; `status=archived` and `action: "inbox"`
  both already existed server-side. This was entirely a client reachability gap.

### 2026-09-05 — Bound message-listing inputs and aggregates

Type: Bug Fix / Performance Fix

Summary:
- Validate finite positive integer limits and nonnegative integer offsets before
  building Drizzle pagination clauses, while preserving the 50 default and 100
  maximum.
- Keep label membership and thread-count aggregation inside D1 with a
  user-scoped label subquery and bounded thread batches.

Reason:
- Invalid limits could produce an unbounded listing when Drizzle omitted an
  invalid `LIMIT`. Label ids and up to 100 thread ids could also exceed D1's
  100 bound-parameter limit after access predicates were included.

Impact:
- Invalid pagination requests now receive a 400 response. Valid folder and
  label listings keep their existing response fields and access behavior while
  large label sets and full pages of distinct threads remain executable on D1.

Tests:
- Added route regressions for invalid/non-finite pagination, label subquery
  compilation, and multi-batch thread-count aggregation.
- Executable SQLite regression covers 101 labeled records and 100 distinct threads;
  every captured statement stays within D1's 100-parameter limit. `npm run verify`
  passes with 2,713 application tests, 100% configured coverage, the complexity gate,
  and 21 bridge tests. All 105 browser tests pass. Deployed 2026-09-06; production smoke 8/8 and remote doctor 26/26 pass (see [F08 rollout evidence](./F08-webhooks.md)).

Notes:
- The batch size is deliberately below the D1 limit to leave room for all
  user, organization, role, and draft access parameters.

### 2026-07-26 — Synchronize mail mutation state across UI views

Type: Correctness / UI State Consistency. See [F72](./F72-mail-ui-state-synchronization.md).

- Successful message mutations now invalidate cached lists and counts before notifying mounted views.
- Detail read state, Starred membership, draft changes, bulk status actions, and navigation counts reconcile
  from one shared client-state contract.

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.
