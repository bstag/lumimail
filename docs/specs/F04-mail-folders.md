# F04 — Mail Folders (Inbox, Sent, Drafts, Spam, Trash)

> Status: Shipped
> Owner area: `src/app/api/messages/*`, `src/app/(dashboard)/{inbox,sent,drafts,spam,trash}/`

## 1. Problem & User Job

Users need to browse, read, and manage email in standard folder organization.
Messages flow through inbox → read → archived/spam/trash just like any email client.

## 2. User Stories & Acceptance Criteria

- As a user, I can view messages in my inbox, sent, drafts, spam, and trash folders.
  - Each folder filters by status + direction (e.g., inbox = inbound + received, sent = outbound + sent).
- As a user, I can read a message and see its full content.
- As a user, I can bulk select messages and move them to spam or trash.
- As a user, I can mark messages as read/unread.

## 3. Scope Boundaries

**In scope:** Folder listing with pagination, message detail view, bulk move to spam/trash, mark read/unread.

**Out of scope:** Labels, custom folders, archiving (non-Gmail style), message threading.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | `id`, `userId`, `organizationId`, `mailboxId`, `direction`, `status`, `read`, `fromAddr`, `toAddr`, `subject`, `snippet`, `threadId`, `createdAt` | |
| `messageBodies` | `textBody`, `htmlBody` | joined for message detail |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/messages` | `getCurrentUser` | query: `mailboxId`, `direction`, `status`, `after?`, `limit?` | `{ messages[], nextCursor? }` | 401 |
| GET | `/api/messages/[messageId]` | `getCurrentUser` | — | `{ message }` + body | 401, 404 |
| POST | `/api/messages/bulk` | `guardUser` | `{ messageIds[], status }` | `{ ok }` | 401, 400 |
| GET | `/api/messages/counts` | `getCurrentUser` | query: `mailboxId` | `{ inbox, sent, drafts, spam, trash }` | 401 |
| POST | `/api/messages/[messageId]/read` | `guardUser` | — | `{ ok }` | 401, 404 |

## 6. UI/UX

- Sidebar nav: Inbox, Sent, Drafts, Spam, Trash with unread counts
- Message list: checkbox, sender, subject, snippet, date
- Message detail: full headers, HTML body (sanitized via DOMPurify)
- Bulk toolbar appears when messages selected
- Empty state per folder: "No emails in {folder}"

## 7. Current Behavior

- All message queries scoped by `userId`
- Inbound email parsed via `postal-mime`, stored with text and HTML bodies
- HTML rendered via `dangerouslySetInnerHTML` after `DOMPurify.sanitize()`
- Bulk operations guarded: `eq(messages.userId, user.id)` in WHERE clause

## 8. Bug / Change Log

### 2026-07-26 — Synchronize mail mutation state across UI views

Type: Correctness / UI State Consistency. See [F72](./F72-mail-ui-state-synchronization.md).

- Successful message mutations now invalidate cached lists and counts before notifying mounted views.
- Detail read state, Starred membership, draft changes, bulk status actions, and navigation counts reconcile
  from one shared client-state contract.

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.
