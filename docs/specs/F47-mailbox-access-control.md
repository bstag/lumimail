# F47 — Mailbox-Level Access Control

> Status: Deployed — Controlled Multi-User Validation Pending
> Remediation: R-12 (specification), R-13 (implementation)
> Owner area: `src/db/schema/`, `src/lib/auth/`, `src/app/api/mailboxes*`, `src/app/api/messages*`, `src/app/api/drafts*`, `src/app/api/attachments*`, `src/app/api/send`, `src/app/api/v1/*`

## 1. Problem and user job

Lumimail currently models organization membership and organization-wide mailbox administration, but it does not model who may read or send from a particular mailbox. Mailbox lists are organization-scoped while stored messages are filtered by their legacy creator `userId`. This produces two unsafe outcomes:

- restricted users can enumerate mailboxes they were not intentionally assigned; and
- a mailbox such as `support@kingdomtasks.com` cannot be shared by two or three users because inbound messages are visible only to the user recorded as the mailbox owner.

The required job is to let a small organization assign each person only the mailboxes they need, share selected mailboxes for team work, and give the owner a designated catch-all mailbox without granting every user access to unrelated mail.

## 2. Prior behavior

- `GET /api/mailboxes` returned every mailbox whose `organizationId` matched the current user.
- Mailbox detail, update, and delete routes checked organization ownership, not mailbox membership or organization role.
- Inbound delivery copied `mailboxes.userId` into `messages.userId`; it did not set `messages.organizationId`.
- Message list, search, counts, thread, detail, body, label, read, starred, status, bulk, attachment, draft, and API-key message routes authorized with `messages.userId`.
- Sending accepted a mailbox when it belonged to the user's organization, so any organization member could select any organization mailbox as a sender.
- `organization_members.role` controlled organization-management routes only and did not grant or restrict mailbox content access.
- Removing a user from an organization cleared their organization link without revoking mailbox-specific grants.

## 3. Desired behavior

### 3.1 Access model

Access is explicit per `(mailboxId, userId)` membership. The proposed membership role is one of:

| Role | List/open mailbox | Read/search/download | Draft/send/reply | Change mailbox settings | Manage members |
|---|---:|---:|---:|---:|---:|
| `viewer` | yes | yes | no | no | no |
| `responder` | yes | yes | yes | no | no |
| `manager` | yes | yes | yes | yes | yes |

Organization roles and mailbox roles are separate:

- organization owners/admins may provision domains and mailboxes according to the organization-admin contract;
- organization role alone does not silently grant message-content access;
- a mailbox manager may assign existing organization members to that mailbox;
- the mailbox creator receives `manager` membership in the same transaction as mailbox creation;
- a catch-all target is an ordinary mailbox and follows the same membership rules.

### 3.2 Message ownership

- `mailboxId` is the authorization boundary for mailbox messages.
- `organizationId` is populated for all new mailbox messages and backfilled for existing mailbox messages.
- legacy `userId` remains as creator/actor metadata during migration, but it is not sufficient authorization for a mailbox message.
- messages and drafts with `mailboxId = null` remain private to their `userId`.

### 3.3 UI behavior

- The dashboard mailbox selector shows only mailboxes where the user has explicit membership.
- Organization admins use a separate administrative mailbox list to configure organization resources without implying content access.
- Mailbox settings show members and roles only to mailbox managers.
- Compose exposes only mailboxes where the user is `responder` or `manager`.
- Direct navigation to an unassigned mailbox or message returns the same not-found response as an unknown resource.

## 4. Data model

Add `mailbox_memberships`:

| Column | Type | Contract |
|---|---|---|
| `id` | text primary key | prefixed ID |
| `mailbox_id` | text not null | FK to `mailboxes`, cascade delete |
| `user_id` | text not null | FK to `users`, cascade delete |
| `role` | text not null | `viewer`, `responder`, or `manager` |
| `created_at` | integer timestamp | audit metadata |
| `updated_at` | integer timestamp | audit metadata |

Constraints and indexes:

- unique `(mailbox_id, user_id)`;
- index `(user_id, mailbox_id)` for mailbox selection and authorization;
- index `(mailbox_id, role)` for membership administration.

Migration behavior:

1. Create the table and indexes.
2. Add one `manager` membership for each existing mailbox's `userId`.
3. Backfill `messages.organizationId` from the message's mailbox.
4. Do not grant every organization member access to every existing mailbox.
5. Verify the migration through the fresh-schema drift test and an upgraded fixture with existing mailboxes/messages.

## 5. Authorization contract

Central helpers must return a scoped mailbox/message or `null`; routes must not load an unscoped row and check it later.

Proposed helpers:

- `getMailboxAccess(db, userId, mailboxId)`
- `requireMailboxRole(db, userId, mailboxId, minimumRole)`
- `selectAccessibleMessage(db, userId, messageId, capability)`
- `listAccessibleMailboxIds(db, userId, capability)`

Capability mapping:

| Operation | Required access |
|---|---|
| Mailbox selector, counts | any membership |
| Message list/detail/thread/search/body/attachments | `viewer+` |
| Read/star/status/labels/bulk mutations | `viewer+`, subject to shared-state decision |
| Draft create/update/delete | `responder+` for a mailbox draft; creator for null-mailbox draft |
| Send/reply/user-initiated forward | `responder+` |
| Mailbox display name/settings | `manager` |
| Add/change/remove mailbox member | `manager` |
| Delete mailbox | organization owner/admin plus explicit confirmation; content access is not implied |

API-key endpoints use the key owner's mailbox memberships plus the key's scopes. A key cannot broaden its owner's access.

## 6. API contract

### Mailbox membership administration

| Method | Route | Body | Result |
|---|---|---|---|
| `GET` | `/api/mailboxes/[id]/members` | — | assigned organization members and roles |
| `POST` | `/api/mailboxes/[id]/members` | `{ userId, role }` | created membership |
| `PATCH` | `/api/mailboxes/[id]/members/[membershipId]` | `{ role }` | updated membership |
| `DELETE` | `/api/mailboxes/[id]/members/[membershipId]` | — | removed membership |

Errors:

- unauthenticated: `401`;
- unknown, cross-tenant, or unauthorized mailbox/member/message: indistinguishable `404`;
- invalid role/body: `400`;
- duplicate membership: `409`;
- removing the last manager: `409` until another manager exists or the mailbox is deleted;
- assigning a user outside the organization: `404`.

## 7. Edge cases and failure states

- Membership changes take effect on the next request; active sessions do not cache authorization.
- Removing a member does not delete messages, drafts, or audit metadata.
- Removing a user from the organization revokes all mailbox memberships transactionally.
- A user cannot remove or demote the last mailbox manager.
- Concurrent membership creation is resolved by the unique constraint and returns `409`.
- A mailbox cannot be used as a sender merely because it is visible in organization administration.
- A routing rule cannot target a mailbox outside its domain/organization; existing F46 behavior remains unchanged.
- Webhooks, filters, labels, contacts, and vacation responders remain user-scoped unless a later mailbox-specific contract explicitly migrates them.
- Attachments inherit authorization from their parent message; direct R2 keys are never accepted from the client.
- Null-mailbox drafts/messages never become organization-visible through an organization join.

## 8. Security invariants

- Cross-tenant isolation remains mandatory before mailbox-role evaluation.
- Authorization uses database state on every request and is never inferred from client-selected mailbox IDs.
- Organization ownership is not a hidden read-all permission.
- List/count/search endpoints filter in SQL by accessible mailbox IDs; they do not fetch organization data and filter it in application memory.
- Message detail and mutation endpoints return the same result for missing and forbidden resources.
- Membership administration cannot assign a user from another organization.
- API keys, attachments, message bodies, and bulk endpoints receive the same mailbox checks as browser endpoints.

## 9. Test plan

### Migration and schema

- fresh D1 contains the table, constraints, and indexes;
- upgrade fixture grants only each existing mailbox owner `manager` access;
- existing mailbox messages receive the correct `organizationId`;
- removing required migration SQL fails schema drift detection.

### Unit/integration

- role matrix for `viewer`, `responder`, `manager`, organization admin without membership, and unrelated tenant;
- mailbox list returns only assigned mailboxes;
- admin resource list does not grant content access;
- list/count/search/thread/detail/read/star/status/labels/bulk/attachments enforce membership;
- drafts and sending require `responder+`;
- mailbox settings and membership CRUD require `manager`;
- last-manager, duplicate, removed-user, and concurrent-change behavior;
- API keys cannot exceed owner membership;
- null-mailbox messages remain creator-private.

### Browser

1. Owner creates `support@kingdomtasks.com` and assigns two invited users as responders.
2. Both responders see and can reply from Support.
3. A viewer can read Support but cannot send.
4. A user assigned only Support cannot see the owner's catch-all or another mailbox.
5. Removing a responder immediately removes Support from their selector and blocks a bookmarked message URL.

### Full verification

- `npm run verify`;
- relevant Playwright ACL scenarios;
- OpenNext production build and Wrangler dry run;
- controlled production invite/share/read/send/revoke flow without recording message content.

## 10. Decisions

- Approved 2026-07-22: explicit mailbox membership is the only content-access grant; organization role alone is insufficient.
- Approved 2026-07-22: creator becomes `manager`; existing mailbox owners are backfilled as managers.
- Approved 2026-07-22: use three composable roles (`viewer`, `responder`, `manager`) instead of independent boolean flags for the MVP.
- Approved 2026-07-22: unassigned resources use not-found responses to avoid enumeration.
- Approved 2026-07-22: catch-all access is granted by assigning users to its target mailbox, not by a domain-wide exception.
- Approved 2026-07-22: an organization owner may explicitly grant themselves mailbox membership through administration; the action is auditable and organization ownership alone still grants no content access.
- Approved 2026-07-22: read/unread, starred, labels, archive, and trash state are shared by all users assigned to a mailbox.

## 11. Open questions

None for the MVP access model. New privacy-affecting behavior requires an explicit specification amendment before implementation.

## 12. Bug / change log draft

### 2026-07-22 — Specify least-privilege shared mailbox access

Type: Security / Feature

Summary:

- Add explicit mailbox memberships and enforce read, send, settings, and membership capabilities across every mailbox-scoped endpoint.

Reason:

- Organization-wide mailbox discovery plus creator-owned messages cannot safely support shared mailboxes or restricted users.

Impact:

- Selected users can share `support@` without gaining access to catch-all or unrelated mailboxes; organization roles no longer imply message-content access.

Tests:

- Migration, capability matrix, endpoint isolation, API-key, browser, build, and controlled production flows listed above.

## 13. Implementation log

### 2026-07-22 — Foundation slice

- Added the `mailbox_memberships` schema and executable D1 migration.
- Backfilled only each existing mailbox owner as `manager`; no organization-wide implicit grants are created.
- Backfilled mailbox message `organizationId` and populated it for new inbound delivery.
- Added centralized role/capability helpers.
- New mailbox creation atomically creates the creator's manager membership.
- The dashboard mailbox list now joins explicit membership and exposes the assigned role.
- Added manager-only membership listing/creation and the approved organization-owner self-assignment exception.
- Added membership role changes and removal with last-manager protection.
- Organization-member removal now revokes that user's mailbox memberships in the same D1 batch.
- Added manager-only mailbox access controls to the mailbox settings UI, including workspace-member selection and viewer/responder/manager role management.
- Mailbox detail and settings now require explicit membership; settings changes require `manager`.
- Added a shared SQL authorization predicate that preserves creator-private null-mailbox messages and grants mailbox-message access only through current membership.
- Applied the predicate to browser message lists, search, counts, bulk actions, detail/body, read/status/star/label mutations, threads, and attachment list/download/upload routes.
- Draft list/create/detail/update/delete routes now require responder/manager access for mailbox drafts while preserving creator-private null-mailbox drafts.
- Sender resolution now joins current mailbox membership, rejects viewers and unassigned users, binds omitted mailbox IDs to the authorized sender mailbox, and records organization IDs on outbound messages/jobs.
- API-key authentication carries the owner's organization into mailbox authorization; message reads and sends require both the relevant key scope and the owner's current mailbox role.
- The client mailbox model carries roles; viewer mailboxes remain readable but cannot provide a compose sender identity.
- Added a separate organization-admin mailbox inventory that does not grant or imply content access.
- Gave the admin inventory its own query-cache namespace so it cannot populate the content-authorized mailbox selector.
- Mailbox creation is organization-admin-only and still grants the creator an explicit manager membership.
- Organization owners can explicitly self-assign manager access from the administrative inventory; unassigned mailboxes remain non-navigable.
- Mailbox deletion is organization-admin-only and requires a case-insensitive exact mailbox-address confirmation in both the UI and API.
- Browser contract coverage verifies the administrative/content-access distinction, owner self-assignment, and typed deletion-confirmation flows.

### 2026-07-23 — Local verification

- `npm run verify`: passed with 125 test files, 1,045 tests, and 100% statements, branches, functions, and lines; lint reported zero errors and 41 pre-existing warnings.
- `npx playwright test --workers=2`: all 24 browser tests passed, including both mailbox-access scenarios. The API-key fixture was completed with mailbox/count mocks so synthetic authentication cannot be cleared by unrelated live layout requests.
- `npx opennextjs-cloudflare build`: passed and generated `.open-next/worker.js`.
- The passing browser run still logged pre-existing missing/invalid translation messages for compose and message actions; those are tracked under R-14 rather than F47.

### 2026-07-23 — Production deployment

- Applied D1 migration `0010_add_mailbox_memberships.sql` successfully.
- Aggregate verification found 2 organization mailboxes, 2 explicit manager memberships, and 0 mailbox messages with a mailbox but no `organizationId`.
- Deployed Worker version `5d3f3c7a-8682-4ebd-84b8-777f8d8d43be` to `mail.henriksen.dev`.
- Live smoke checks: `/` returned `200`; unauthenticated `/api/mailboxes` and `/api/admin/mailboxes` returned JSON `401`.
- The owner subsequently assigned a real user and manually validated the visible behavior of all three mailbox roles: `manager`, `responder`, and `viewer`.

Still pending before R-13 can be marked shipped: explicitly verify unrelated-mailbox isolation and immediate revocation in the live second-user session. The production checks are required because the current browser suite mocks API responses and does not itself prove D1 row isolation between two live users.

## 14. Follow-up observations

- Role-aware UI affordances are incomplete. The server correctly rejects unauthorized send/manage operations, but Compose remains visible to viewer-only users and the compose surface merely lacks a valid sender. A follow-up should hide or disable compose, reply, forward, draft-edit, and management affordances from current capabilities while retaining every server-side check and guarding direct navigation.
- Compose autosaves about 900 ms after non-empty content changes and associates the draft with the selected mailbox. That makes the stored draft mailbox-scoped, but other open sessions receive no live refresh. There is no polling, push event, collaborative presence, edit lock, version check, or conflict handling.
- The general message-list endpoint currently evaluates draft rows with read capability, while the dedicated draft routes require send capability. The follow-up must decide and enforce one contract; the safer default is that viewers cannot list or read draft metadata/content.
