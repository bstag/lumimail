# F93 — Bounded-memory external synchronization

> Status: Deployed 2026-09-06; controlled provider/load evidence pending
> Owner area: `src/lib/email/external/provider-client.ts`,
> `src/lib/email/external/provider-adapter.ts`, `src/lib/email/external/sync-page.ts`,
> `src/lib/email/external/sync-queue.ts`

## 1. Problem & User Job

An external Sync Page may contain up to ten provider messages. A provider MIME
message is allowed to be as large as 30 MiB, so retaining every raw MIME value
while fetching a page and then retaining every parsed body in a D1 batch can exceed
the 128 MiB memory limit of a Cloudflare Worker. A mailbox user must still receive
every valid change in the page, and a failed attempt must remain safe to retry.

## 2. User Stories & Acceptance Criteria

- As a mailbox user, I can import every valid message in a provider page without a
  Worker memory failure caused by aggregate page buffering.
- Given a provider page with multiple additions, raw MIME is fetched/materialized
  one message at a time and each message is prepared and persisted before the next
  message is materialized.
- Given a provider page whose later message or final cursor write fails, the cursor
  remains at its previous value and the existing provider retry or operator recovery
  path can replay the same page.
- Given a retry after an earlier message from that page was committed, the existing
  external account/message mapping makes the replay idempotent and does not create a
  duplicate Lumimail message.
- Given a page succeeds for every message, its provider cursor mutation is committed
  only after all message writes succeed.

## 3. Scope Boundaries

**In scope:**

- Lazy provider MIME loading for Google and Microsoft page changes.
- Sequential per-message preparation and D1 persistence within one Sync Page.
- Final cursor-only D1 batch after all page messages are durable.
- Retry, partial-completion, replay, and R2-compensation tests.

**Out of scope:**

- Provider page-size changes or rejection of otherwise valid provider pages.
- Schema or migration changes, a new spool bucket, or changes to message-body read
  paths.
- A change to provider cursors, queue payloads, account leases, or user-visible
  sync statuses.

## 4. Data Model

No schema or migration changes. Existing `external_messages` remote-message mapping
uniqueness supplies idempotency for a message committed before a later page failure;
`external_sync_cursors` advances only in the final cursor batch.

## 5. API Contract

No HTTP route changes. The internal `ExternalRemoteChange` contract may carry a
lazy `loadRawMime` function. A provider adapter returns metadata plus that loader;
the loader is consumed by Sync Page application immediately before preparation.

## 6. UI/UX

No user-visible UI changes. A page that partially commits before a retry continues
from the same provider cursor and eventually reaches the existing active/completed
state when the page and subsequent cursor commit succeed.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|----------------|
| Unit | `tests/unit/lib/email/external/provider-client.test.ts` | Google and Microsoft page changes defer MIME loading and preserve size/error checks when the loader is consumed |
| Unit | `tests/unit/lib/email/external/sync-page.test.ts` | loaders are consumed sequentially; message batches are bounded; cursor is final; partial replay remains safe |
| Unit | `tests/unit/lib/email/external/sync-queue.test.ts` | page retry still uses the unchanged cursor after a late failure |
| Unit | `tests/unit/lib/email/external/provider-adapter.test.ts` | adapter preserves all folder changes and cursor mutations while using lazy MIME changes |

Coverage target: 100% for changed runtime files.

## 8. Current Behavior

- Google and Microsoft return page metadata with lazy MIME loaders. Provider pages
  retain no aggregate raw MIME buffers.
- Sync Page application loads, prepares, and commits one message before loading the
  next. Parsed bodies and D1 statements are scoped to that message.
- Each message has its own R2 compensation boundary. Earlier committed messages
  remain durable after a later failure and replay through existing remote-ID mapping.
- Cursor changes commit in a final batch only after every message succeeds. The
  existing per-message size limits and sync error classification remain in force.

## 9. Error States

| Condition | User-visible result | Runtime behavior |
|---|---|---|
| One provider MIME loader fails | Existing classified provider retry/error state | No cursor advancement; already committed earlier messages remain and replay idempotently |
| One message preparation or its D1 batch fails | Existing terminal sync error/recovery state | Stop the page; cursor remains unchanged; R2 objects for the failed/uncommitted message are compensated |
| Final cursor batch fails | Existing terminal sync error/recovery state | Cursor remains unchanged; all committed page mappings are replayed idempotently when the page is recovered |
| Provider MIME exceeds 30 MiB or is malformed | Existing provider error classification | Reject that message/page according to current provider error handling; never advance the cursor |

## 10. Edge Cases

- Empty pages still commit their cursor mutation once, with no message batch.
- Removed messages have no MIME loader and continue through the existing mapping
  update/ignore path.
- Duplicate remote IDs in one page are deduplicated before any loader is consumed.
- A later failure after one or more messages were committed must not cause a second
  Lumimail message when the page is replayed.
- Microsoft's three folder pages retain all changes and cursor mutations while
  applying message loaders sequentially across folders.
- A cursor must never advance when any loader, parser, R2 write, message batch, or
  cursor encryption/batch operation fails.
- Account lease ownership remains the concurrency boundary; this change does not
  add a second worker or allow overlapping page application.

## 11. Permissions & Security

- Existing account, mailbox, organization, and provider authorization checks remain
  unchanged.
- Lazy loaders capture only the short-lived access token already supplied to the
  provider adapter and are not serialized into queue payloads or D1.
- Provider MIME and error bodies remain outside logs and user-facing error messages.

## 12. Open Questions / Decisions

- Decision → 2026-09-05: use lazy MIME loaders plus sequential message persistence;
  do not lower provider page size or reject valid pages.
- Decision → 2026-09-05: a Sync Page's cursor is the final progress marker. Message
  writes may partially commit before a later failure, but every such write is
  idempotent through the existing account/remote-message mapping and is replayed
  safely before the cursor can advance. Retryable provider errors keep the existing
  automatic retry behavior; generic D1/application failures retain the existing
  terminal error and operator/manual recovery behavior.
- Decision → 2026-09-05: retain existing single-page D1 atomicity for the final
  cursor decision while accepting durable per-message commits to stay within the
  Worker memory budget without schema/body-read redesign.

## 13. Bug / Change Log

### 2026-09-05 — Bound external Sync Page memory

Type: Performance Fix / Behavior Change

Summary:

- Defer provider MIME bodies and apply each message in a bounded per-message D1
  batch before committing the page cursor.

Reason:

- Concurrent or aggregate retention of ten 30 MiB MIME messages plus parsed body
  statements can exceed the Cloudflare Worker 128 MiB isolate limit.

Impact:

- Valid provider pages remain fully imported. A late page failure can leave earlier
  message mappings committed, but the unchanged cursor makes the existing retry or
  operator recovery replay idempotent; no message is skipped and no duplicate is
  created.

Tests:

- Provider lazy-loader, sequential application, partial replay, and compensation
  regressions pass. `npm run verify` passes with 2,713 application tests, 100%
  configured coverage, the complexity gate, and 21 bridge tests. All 105 browser
  tests pass. Live Google/Microsoft and production memory/load evidence remain
  pending; deterministic tests establish sequential materialization and persistence.

Notes:

- Deployed 2026-09-06 in Worker `3e2a434f-5cb1-4320-b195-8890b67a9605`;
  production smoke 8/8 and remote doctor 26/26 pass. See [F08 rollout evidence](./F08-webhooks.md).
- Cloudflare documents a 128 MiB per-isolate memory limit and recommends streaming
  or otherwise avoiding large response buffering. See the Workers limits and Streams
  references in F89.
