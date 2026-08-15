# F86 — Desktop Split View and Conversation Rows

> Status: Shipped
> Owner area: `src/components/messages/`, dashboard folder/detail routes, `/api/messages`

## 1. Current Behavior

Folder pages render a single message list. Selecting a row navigates to a full-page detail route.
Rows show party, subject, preview, mailbox/delivery metadata, and time, but no avatar or bounded
thread count. The current mobile/full-page experience is stable and must remain the fallback.

## 2. Desired Behavior

- At desktop widths, selecting a non-draft row keeps the folder list visible and opens its existing
  detail/thread experience in a right-hand panel.
- Selection uses a `message=<id>` query parameter on the folder URL so refresh, copy, back, and
  forward retain state. Existing `/folder/[messageId]` direct links remain full-page routes.
- At mobile widths, rows continue to navigate to the existing full-page detail route.
- Desktop list/detail widths are resizable within bounded minimums and saved locally. The separator
  is keyboard operable and exposes separator/value semantics.
- The conversation panel position is a per-device preference: beside the list (right, default) or
  below it. A toggle in the list toolbar, available while a conversation is open, switches the
  orientation immediately and persists it locally. Both orientations keep bounded resizing with the
  matching separator orientation and keyboard axis, and each remembers its own size.
- Closing the panel removes only the message query parameter and restores focus to the selected row.
- Only the selected message loads detail/body/thread data. List rendering never fetches every body.
- Rows add a deterministic avatar/initial and a thread count. The list API computes counts in one
  bounded query for only the page's unique thread IDs, never one query per row.
- Existing unread, starring, delivery recovery, bulk selection, pagination, mailbox scoping, query
  keys, optimistic rollback, and account-switch isolation remain unchanged.

## 3. Edge and Error States

- A missing/forbidden selected message shows the existing bounded not-found state inside the panel
  without removing the list.
- Unknown or repeated `message` parameters fail closed to no panel.
- Draft rows continue to open the draft composer and never open the detail panel.
- Resize values outside bounds, malformed storage, viewport shrink, and keyboard input are clamped.
- When the breakpoint changes to mobile with a panel selected, the full-page route is used only after
  the next explicit row activation; the app does not surprise-navigate during resize.
- Thread counts default to one when a message has no thread ID and cannot expose inaccessible rows.

## 4. Scope Boundaries

In scope: inbox, sent, archive, spam, trash, starred, and label list presentations; reusable detail
view; bounded thread-count enrichment; desktop resizer; URL/history/focus behavior.

Out of scope: drafts, body prefetch for all rows, infinite scroll, replacing full-page routes,
changing thread grouping, or push notifications.

## 5. Test Plan

| Layer | Coverage |
|---|---|
| Unit | panel width parsing/clamping; query-param selection; avatar initials; thread-count merge |
| API | one bounded thread-count query, access predicate retained, no cross-tenant count leakage |
| E2E | desktop open/close/back/refresh, resizer keyboard semantics, richer rows, mobile full-page navigation, drafts unchanged |
| Local D1 | permitted thread counts exclude inaccessible same-thread/cross-mailbox data |
| Full | `npm run verify`, `npm run e2e`, and migrated-local-D1 E2E |

## 6. Decisions

- Decision: use a folder query parameter rather than intercepting/parallel routes. Direct detail URLs
  keep their current behavior and the list remains the route source of truth. — 2026-08-13
- Decision: reuse the existing detail component and TanStack query keys; the panel is presentation,
  not a second message implementation. — 2026-08-13
- Decision: no body prefetch. Only route code and bounded list metadata may prefetch. — 2026-08-13

## 7. Bug / Change Log

### 2026-08-14 — Reading-pane position option

Type: Feature

- Add a per-device split orientation preference (`right` | `bottom`) with a toolbar toggle shown
  while a conversation is open. Unknown stored values fail closed to `right`.
- The bottom orientation resizes by height with `aria-orientation="horizontal"`, ArrowUp/ArrowDown
  keyboard steps, and its own bounded persisted size; the right orientation is unchanged.
- Verified: typecheck and lint clean, 2,332 unit tests pass with the 100% coverage gate, all 100
  mocked Chromium scenarios pass (including the new orientation toggle/persistence scenario), and
  both orientations were exercised live against a local server.

### 2026-08-13 — Specify optional desktop split view

Type: Feature

- Reserve F86 for the HQBase-inspired desktop presentation after resolving the old F84 numbering
  collision.
- Preserve full-page/mobile behavior, accessibility, bounded queries, and mailbox isolation.

### 2026-08-13 — Ship the desktop conversation workspace

Type: Feature

- Reuse the existing message detail/thread experience inside a wide-screen conversation panel while
  preserving every direct detail route and the mobile full-page flow.
- Synchronize selection through the folder URL, restore row focus on close, and provide a persisted,
  bounded pointer/keyboard resizer with separator semantics.
- Add avatar initials and one access-scoped aggregate thread-count query for only the visible page.
  A real-D1 fixture proves that an inaccessible same-thread message cannot inflate the count.
- Verification passes 18 focused unit contracts, four split-view Chromium scenarios, all 94 mocked
  Chromium scenarios, all 53 migrated real-D1 scenarios, and 2,127 application tests at 100%
  statement, branch, function, and line coverage. The bridge suite remains part of the final gate.
