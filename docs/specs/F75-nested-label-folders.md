# F75 — Nested Label Folders

> Status: Shipped (local)
> Owner area: `src/app/api/labels/*`, `src/app/(dashboard)/label/`, `src/components/dashboard-nav.tsx`, `src/db/schema/index.ts`

## 1. Problem & User Job

A user with several mailboxes wants durable, self-chosen destinations to file mail
into — "Invoices", "Clients/Acme", "Clients/Northline" — and wants filters to file
mail there automatically.

Lumimail already has most of this and does not surface it. `labels` +
`message_labels` is a per-user, many-to-many tag system; `messageFilters.actionLabelId`
already files inbound mail into a label on delivery; and `GET /api/messages?labelId=`
already filters a list. What is missing is a way to *browse* a label: `/labels` is
create/delete only, and there is no route that lists one label's messages.

This feature promotes labels to first-class sidebar destinations and adds one level
of structure — a parent label — so related labels group under a heading rather than
sprawling as a flat list.

## 2. User Stories & Acceptance Criteria

- As a user, I can click a label in the sidebar and see the mail carrying it.
  - Given a label with N messages, When I open `/label/<id>`, Then I see those N
    messages, newest first, paginated at 25 like every other folder.
  - **Trashed and spam mail is excluded.** A label is a filing destination; mail
    the user deleted still carries the label, but listing it there would make the
    label look like it holds things the user thought they had thrown away. The
    view requests `LABEL_VISIBLE_STATUSES` (received, sent, draft, queued, failed,
    archived) — an allowlist, so a future status must be added deliberately rather
    than appearing in label views by default.
  - The list obeys the active mailbox scope: a label view under one selected
    mailbox shows only that mailbox's labelled mail (and under All mailboxes,
    F76, shows every accessible mailbox's).
- As a user, I can nest a label under a parent so related labels group together.
  - Given label "Acme" with `parentId` = "Clients", When I open the sidebar, Then
    "Acme" renders indented beneath "Clients".
  - Nesting is exactly **one level deep**. A label whose own parent has a parent is
    rejected with 400.
  - A label cannot be its own parent (400), and a parent cannot be moved under its
    own child (400 — would create a cycle).
- As a user, deleting a parent label does not silently delete my mail or my child
  labels.
  - Given "Clients" has children, When I delete it, Then its children are promoted
    to top level (`parentId` → NULL) and their messages keep those child labels.
- As a user, a label I have no access to is not reachable.
  - Given a label belonging to another user, When I open `/label/<that id>`, Then I
    get the not-found empty state and no message rows.

## 3. Scope Boundaries

**In scope:** one-level label nesting (`labels.parentId`), a `/label/[id]` browse
view reusing `MessageFolderPage`, labels rendered as sidebar destinations with
per-label counts, parent selection and rename in the `/labels` manager, cycle and
depth validation.

**Out of scope:**

- Arbitrary-depth trees. One level is the shipped depth; deeper nesting needs a
  recursive count/query strategy and is a separate feature.
- Per-label unread badges in the nav (labels get a total count, not an unread
  count — the unread concept belongs to Inbox/Spam).
- Drag-and-drop reordering or manual sort. Labels sort by name within a parent.
- Sharing labels across users. Labels stay per-user (`labels.userId`); a shared
  mailbox does not imply shared labels.
- Applying/removing a label from the message list UI. Filters and the existing
  label chips remain the ways mail gets labelled.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `labels` | **new** `parent_id` text NULL → `labels.id` ON DELETE SET NULL | One level only, enforced in the route, not the schema |
| `labels` | **new index** `labels_user_parent_idx` on (`user_id`, `parent_id`) | Sidebar tree build reads by parent |
| `message_labels` | `messageId`, `labelId` | Unchanged; the join already exists |
| `messages` | read-only | Listed via the existing `labelId` filter |

Migration: `drizzle/migrations/0028_add_label_parent.sql`, hand-written and
append-only per the project convention. `ON DELETE SET NULL` is what implements the
"promote children on parent delete" rule, so it is enforced by the database rather
than by application code that could be bypassed.

`tests/unit/db/migrations.test.ts` verifies exact Drizzle-schema parity on both a
fresh and an upgraded database; `src/db/schema/index.ts` must be updated to match in
the same change.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/labels` | `withUser` | — | `Label[]` incl. `parentId` | 401 |
| POST | `/api/labels` | `withUser` | `{ name, color, parentId? }` | `Label` | 400 (depth/cycle/invalid parent), 401 |
| PATCH | `/api/labels/[id]` | `withUser` | `{ name?, color?, parentId? }` | `Label` | 400, 401, 404 |
| DELETE | `/api/labels/[id]` | `withUser` | — | `{ id }` | 401, 404 |
| GET | `/api/messages?labelId=` | `withUser` | existing | existing | 401 |

`createLabelSchema` / `updateLabelSchema` in `src/lib/validators.ts` gain an optional
nullable `parentId`. Depth and cycle rules are **not** expressible in Zod (they need
a database read), so they are enforced in the route handler and return
`apiError(..., 400)`.

Parent validation lives in `getLabelParentError` (`src/app/api/labels/utils.ts`),
a pure function the handlers call after doing their lookups. Order:

1. `parentId !== labelId` → else 400 "A label cannot be its own parent". Checked
   first, and before the lookup result is consulted, so self-parenting reports
   itself rather than surfacing as whatever the row's own parent state implies.
2. `parentId` must resolve to a label owned by the same user → else **404**, not
   403: a 403 would confirm that someone else's label id exists.
3. that parent's own `parentId` must be NULL → else 400 "Labels nest one level deep"
4. the label being updated must have no children of its own → else 400 "Move this
   label's children first", since giving it a parent would put its children at a
   third level

`parentId: null` explicitly promotes a label to top level and skips all four
checks — there is no parent to validate.

## 6. UI/UX

- **New route** `src/app/(dashboard)/label/[id]/page.tsx` — client component reading
  the route param and rendering `MessageFolderPage` with a `labelId`-scoped config.
  This requires `MessageFolderConfig` to carry an optional `labelId` and
  `MessageFolder` to gain a `"label"` member whose query params set only `labelId`.
- **Sidebar** (`dashboard-nav.tsx`): `LabelNavTree` renders directly beneath the
  existing `Labels` nav entry — top-level labels with their children indented one
  step, each a link to `/label/<id>` carrying its colour dot. The `Labels` entry
  itself is **kept** as the manage affordance rather than being replaced by a
  section header: `tests/e2e-local/navigation.spec.ts` navigates by a link named
  "Labels", and the collapsed rail has no other way to reach label management.
- **Collapsed rail**: the tree is hidden. A label has a colour, not an icon, so a
  rail of unnamed dots would not be navigable. The `Labels` entry stays, so
  management is reachable in both states.
- **Empty states**: no labels at all → the section is hidden entirely (no empty
  heading); a label with no messages → "No messages with this label".
- **Loading**: the section renders nothing until the labels query resolves, matching
  how the nav already gates on `isLoading`.
- **Not found / not yours**: `/label/<unknown>` renders the empty state, not a crash
  — the messages API already returns an empty list for a label the user cannot read.
- **Mobile**: labels do not enter `MOBILE_TAB_PRIORITY` (four slots, already
  contested). They are reachable from the full nav sheet.
- **RTL**: indentation uses logical properties (`ps-*`), not `pl-*`, so Arabic nests
  from the right.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/labels-tree.test.ts` | `buildLabelTree` ordering, orphan handling (a child whose parent was deleted mid-render), grandchild promotion, case-insensitive sort, empty input |
| Unit | `tests/unit/app/api/labels/parent-rules.test.ts` | every `getLabelParentError` branch |
| Unit | `tests/unit/app/api/labels/route.test.ts` | POST: nested create, missing parent → 404, two-level parent → 400, null parent stored |
| Unit | `tests/unit/app/api/labels/[id]/route.test.ts` | PATCH: nest, missing parent → 404, self-parent → 400, has-children → 400, promote to top level |
| Unit | `tests/unit/hooks/label-folder.test.ts` | `getMessageQueryParams("label", …)` sets `labelId`, no `direction`, and excludes trash/spam |
| Unit | `tests/unit/db/migrations.test.ts` | existing parity check covers `0028` on fresh + upgraded databases |
| E2E | `tests/e2e/label-folders.spec.ts` | sidebar tree order, opening a label, empty label state, unreadable label id, no-labels case |

Coverage target: 100% on new/changed files matching the gate globs
(`src/lib/**/*.ts`, `src/app/**/*.ts`, `src/components/**/*-utils.ts`).

## 8. Current Behavior

- `labels` is flat: `id`, `userId`, `organizationId`, `name`, `color`, `createdAt`,
  unique on (`userId`, `name`). No parent column.
- `/labels` creates and deletes labels. It cannot rename, recolour, or nest them.
- Labels appear in the UI in exactly two places: the `/labels` manager, and the
  filter chips row above a folder list (`MessageFolderPage`), which filters the
  *current folder* by label.
- `GET /api/messages?labelId=` resolves the label's message ids via `message_labels`
  and filters the list. It does not verify the label belongs to the caller — it does
  not need to, because `messageAccessCondition` already restricts the rows, so an
  unknown label id yields an empty list rather than another user's mail.
- `messageFilters.actionLabelId` attaches a label on inbound delivery.

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|--------------|---------|
| `parentId` names a label the user does not own or that does not exist | "Label not found" | 404 | No |
| `parentId` names a label that itself has a parent | "Labels nest one level deep" | 400 | No |
| `parentId` equals the label's own id | "A label cannot be its own parent" | 400 | No |
| Setting a parent on a label that has children | "Move this label's children first" | 400 | No |
| Duplicate label name for the user | existing unique-index failure surfaced as 400 | 400 | No |
| Unauthenticated | existing `withUser` behavior | 401 | No |

## 10. Edge Cases

- **Parent deleted while its child list is open** — `ON DELETE SET NULL` promotes
  children; the next nav refetch renders them at top level. No orphan rows.
- **Child rendered before its parent loads** — `buildLabelTree` treats a child whose
  `parentId` matches no known label as top level rather than dropping it.
- **Label with 0 messages** — empty state, not a hidden nav entry. A deliberate
  destination that happens to be empty still exists.
- **Large label** — paginated at 25 by the shared folder page; no separate limit.
- **Concurrent rename to a colliding name** — the unique `(userId, name)` index
  rejects the second write; surfaced as 400.
- **Cross-tenant** — every read path goes through `messageAccessCondition`; the
  label list is filtered by `labels.userId`. A cross-user label id yields an empty
  message list, tested explicitly.
- **Mobile viewport** — nav sheet only; no bottom-bar slot.
- **RTL** — logical indentation properties.

## 11. Permissions & Security

- Labels are **per-user**, not per-mailbox and not per-organization. A user with
  access to a shared mailbox does not see another member's labels for that mailbox.
- Every label read/write filters on `labels.userId`. Every message read continues
  through `messageAccessCondition(db, user.id, user.organizationId, "read")`.
- A parent label belonging to another user returns **404, not 403** — 403 would
  confirm the id exists.
- No secrets are involved; labels carry a name and a colour.
- Not audited — labels are personal organization, not a security boundary.

## 12. Open Questions / Decisions

- **Flat vs nested?** → Nested via a `parentId` column, one level deep. Chosen
  2026-07-31 over a flat list and over a name-convention tree ("Work/Acme"), because
  the flat name would remain the source of truth under a convention and renaming a
  parent would mean rewriting every child's name.
- **Do labels scope to a mailbox?** → No. `labels` has no `mailboxId` and gains
  none. Labels spanning mailboxes is the property that makes this useful with F76.
- **Unread counts per label?** → No, total only. Deferred; see Out of scope.
- **Does deleting a label delete its mail?** → No. `message_labels` cascades on
  label delete, which removes the *attachment*, never the message.
- **Does a label view include trash and spam?** → No. Decided during
  implementation, 2026-07-31; see §2. The original draft said "every message
  carrying it", which would have surfaced deleted mail inside a filing
  destination.
- **Where does `MessageCounts` put a label bucket?** → Nowhere.
  `MessageCounts["folders"]` is keyed by `CountedFolder = Exclude<MessageFolder,
  "label">`. A label is a filter over other folders' mail rather than a place mail
  lives, so giving it a count bucket would have forced every counts literal in the
  codebase to invent a meaningless `label: { total: 0 }`.

## 13. Bug / Change Log

### 2026-07-31 — Nested label folders

Type: Feature

Summary:
- `labels.parentId` (migration `0028_add_label_parent.sql`, `ON DELETE SET NULL`)
  with one-level depth and cycle rules enforced in `getLabelParentError`.
- `/label/[id]` browse view via the shared `MessageFolderPage`, with a new
  `"label"` `MessageFolder` whose query excludes trash and spam.
- `LabelNavTree` renders the user's labels beneath the `Labels` nav entry.
- `MessageCounts["folders"]` re-keyed to `CountedFolder`.

Reason:
- Filters could file mail into a label and nothing in the UI could open one, so an
  auto-filing rule had no visible destination.

Impact:
- Additive. Existing flat labels get `parentId = NULL` and keep working unchanged.
  No existing route or response shape changed; `parentId` is a new optional field.

Tests:
- See §7. Migration parity verified on both a fresh and an upgraded database.

Notes:
- The `Labels` nav entry was deliberately kept rather than converted to a section
  header — `tests/e2e-local/navigation.spec.ts` navigates by that link name, and
  the collapsed rail needs it.
- Not yet exercised against the real local backend: `npm run e2e:local` cannot run
  in this environment (see §14).

## 14. Not verified

- `npm run e2e:local` fails at sign-in on this machine with a 503 from the
  rate-limit store — local Wrangler bindings are not configured. Confirmed
  pre-existing (it fails identically with these changes stashed), but it means the
  label routes have not been exercised against a real D1 database. The migration
  itself *is* verified against real SQLite by `tests/unit/db/migrations.test.ts`,
  which applies it through Wrangler on both a fresh and an upgraded database.
