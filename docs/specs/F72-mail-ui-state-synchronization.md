# F72 — Mail UI State Synchronization

> Status: Shipped (local)
> Owner area: `src/hooks/`, `src/components/messages/`, `src/components/message-actions/`, `src/app/(dashboard)/*`

## 1. Problem & User Job

Mail mutations currently refresh different parts of the UI through different paths. A message opened
from Inbox can decrement the sidebar unread count while the cached Inbox row remains bold. Starring a
message can update the current list optimistically while another folder later reuses stale cached data.
The user needs every mail view to reflect a successful action consistently without manually reloading.

## 2. Desired Behavior

- A successful read/unread change updates folder rows, detail controls, filtered lists, and navigation
  counts.
- A successful star/unstar change updates the current row and invalidates every cached folder result.
  Unstarring from Starred removes the message from that filtered view after reconciliation.
- Successful bulk moves, delivery retries, draft changes, and sends invalidate message lists and counts.
- Cache invalidation happens even when the folder that will consume the change is not mounted.
- Failed mutations do not announce a change. Optimistic star changes roll back and surface the prior
  state.
- Detail-page automatic mark-as-read and manual read/unread actions update the detail page's own state,
  not only the sidebar.

## 3. Current Behavior

- `useMessages` and `useMessageCounts` subscribe to `lumimail:messages-changed`.
- Each subscriber clears only the cache it owns before refetching.
- If no message-list subscriber is mounted when an event fires, the module-level list cache remains
  stale and is reused on later navigation.
- Row star toggles neither validate non-2xx responses nor publish a shared change event.
- The detail page fetches into component state, so `router.refresh()` does not update its `read` value.

## 4. State Contract

All successful message mutations publish through one client-state helper. The helper synchronously
invalidates both module-level caches before dispatching `lumimail:messages-changed`. Mounted consumers
then force-refetch; later-mounted consumers cannot reuse pre-mutation cached results.

Local optimistic state remains allowed for immediate feedback, but the server response is authoritative:
non-2xx and network failures roll back. Filtered membership is reconciled by the shared refetch.

## 5. Pages and Interactions Reviewed

| View | Read/unread | Star/unstar | Move/status | Background status |
|---|---|---|---|---|
| Inbox | row style + count | row state; Starred membership | archive/spam/trash removes row | n/a |
| Starred | row style + count | unstar removes row | move reconciles membership/status | n/a |
| Sent | n/a for outbound emphasis | row state | trash/archive removes row | queued delivery polling |
| Drafts | n/a for outbound emphasis | row state | trash/archive removes row | shared-draft polling |
| Spam | row style + count | row state | trash/inbox/status removes row | n/a |
| Trash | row style | row state | status changes reconcile row | n/a |
| Message detail | automatic + manual state | list state on return | redirect and destination lists | n/a |
| Sidebar/mobile navigation | unread counts | no badge currently | folder counts | n/a |

## 6. Edge Cases and Error States

- A mutation succeeds while the destination/source folder is unmounted.
- A stale in-flight request completes after invalidation and must not repopulate the cache.
- A star request returns non-2xx without throwing.
- A component unmounts before an automatic read request completes.
- Search, label, pagination, and mailbox-scoped list cache entries are all invalidated together.

## 7. Test Plan

- Unit: publishing a message change invalidates cached list and count results even with no subscribers.
- Unit: mutation helpers publish only after successful responses and reject non-2xx responses.
- Unit: automatic read reports success to its owning detail view.
- Existing API route tests continue to cover tenant isolation and persisted field/status updates.
- E2E: open unread Inbox message and return; row is no longer bold and count remains updated.
- E2E: star in Inbox, visit Starred, return to Inbox; both views show the starred state.
- E2E: unstar from Starred; the row leaves that filtered list.

## 8. Decisions

- Keep the existing lightweight module caches and browser event rather than introducing a second query
  system for mail data.
- Invalidate all message list variants after a mutation. Correct cross-folder and filtered membership is
  more important than retaining potentially invalid cached pages.
- Treat HTTP errors as mutation failures even when `fetch` resolves normally.

## 9. Bug / Change Log

### 2026-07-26 — Draft shared mail-state invalidation contract

Type: Correctness / UI State Consistency.

- Document stale navigation-cache behavior, filtered folder reconciliation, detail-local state, and
  expected failure handling before implementation.

### 2026-07-26 — Apply shared invalidation to every mail mutation

Type: Correctness / UI State Consistency.

- Added one publisher that invalidates message lists and counts before notifying mounted consumers.
- Routed automatic/manual read changes, starring, bulk actions, retry, draft save/delete, and send
  through that publisher.
- Kept detail read controls synchronized locally and prevented manual mark-unread from immediately
  retriggering automatic mark-read.
- Made non-2xx star responses fail and roll back optimistic row state.

## 10. Verification

- `npm run verify` — passed: 168 Vitest files, 1,491 tests, 100% gated coverage, plus 16
  IMAP-bridge tests. Existing lint warnings remain; there are no lint errors.
- `npm run e2e` — all 46 Chromium tests reported passing assertions. The command did not exit before
  the 120-second runner limit because the configured web server attempted a Wrangler remote proxy
  teardown without `CLOUDFLARE_API_TOKEN`; no browser assertion failed.
