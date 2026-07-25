# F63 — R2 Retention and Orphan Cleanup

> Status: In Progress — implemented and locally verified; not yet deployed
> Owner area: `src/lib/email/inbound.ts`, `src/lib/r2-retention.ts`, `worker.ts` scheduled handler, `/api/admin/r2-retention`

## 1. Problem & User Job

Every object Lumimail writes to R2 should reach an intentional retained or deleted
state. Several classes currently reach neither and accumulate forever.

The Worker's `email()` handler writes the raw MIME to `inbound/<timestamp>-<id>.eml`
*before* any routing decision. When the queue consumer then finds no mailbox target —
because the address is unroutable, the rule is `reject`, or (since F62) the address is
forward-only — it returns before writing any D1 row. The object is referenced by
nothing and is never deleted.

For messages that *are* stored, the raw object is retained indefinitely and its key is
recorded in `message_bodies.raw_r2_key`. That column is write-only: no route or feature
ever reads the raw MIME back, so the storage is currently pure cost.

Attachment objects are keyed `attachments/<userId>/<messageId>/<id>`. `attachments.message_id`
cascades on message delete, so deleting a draft — or deleting a mailbox, which cascades
to its messages — removes the metadata rows while leaving the R2 objects behind.

An operator needs to know that storage is bounded, that nothing is silently retained,
and that existing accumulation can be measured before anything is deleted.

## 2. Retention Policy

Decided 2026-07-25. These are the intentional terminal states.

| Class | Key prefix | Policy | Mechanism |
|-------|-----------|--------|-----------|
| Raw MIME, message successfully stored | `inbound/` | Deleted once processing succeeds | Consumer, immediately |
| Raw MIME, unroutable / rejected / forward-only | `inbound/` | Retained 7 days, then deleted | Scheduled sweep |
| Attachment, message exists | `attachments/` | Retained while referenced | No action |
| Attachment, message deleted or cascaded away | `attachments/` | Deleted once unreferenced and older than 7 days | Scheduled sweep |
| Pre-existing accumulation | any | Reported first, deleted only on explicit operator confirmation | Admin endpoint |

The raw copy is redundant after processing because the body, HTML, and attachments are
already extracted into D1 and R2. Deleting it does irreversibly lose headers Lumimail
does not parse; this was accepted explicitly rather than by omission.

## 3. Scope Boundaries

**In scope:**

- Deleting the raw object after successful inbound processing and clearing `raw_r2_key`.
- A sweep that deletes objects which are unreferenced in D1 *and* older than the retention age.
- An owner-only report of what the sweep would delete, with counts and bytes, before anything is deleted.
- A guarded delete requiring explicit confirmation.
- Bounded, resumable operation so one run cannot exhaust Worker CPU or subrequest limits.

**Out of scope:**

- Deleting attachments belonging to messages that still exist, including trashed ones. Trash is a status, not a deletion.
- A user-visible "download original message" feature. Its absence is why raw is deletable at all; adding it later would require revisiting §2.
- Backup and restore, which the production-readiness gate covers separately.
- R2 lifecycle rules configured outside the application; retention must be observable from Lumimail.

## 4. Data Model

No new tables. Age is derived from R2's own `uploaded` timestamp, and referencedness is
derived from `message_bodies.raw_r2_key` and `attachments.r2_key`. Avoiding a ledger keeps
the inbound hot path free of an extra D1 write, which matters because F62 already added a
routing read there.

`message_bodies.raw_r2_key` becomes `null` once the raw object is deleted, so the column
never names an object that does not exist. `message_bodies.message_id` cascades on message
delete, so a deleted message also drops the reference and its raw object — if one still
exists — becomes sweepable.

## 5. API Contract

`/api/admin/r2-retention`, owner-only via `guardOrgOwner`, matching `/api/admin/queue-health`.

| Method | Body | Result |
|--------|------|--------|
| GET | — | `{ scanned, orphans, bytes, oldestUploadedAt, sample }` — a dry-run report. Deletes nothing. |
| POST | `{ confirm: "delete", limit? }` | Deletes up to `limit` reported orphans and returns `{ deleted, bytes, remaining }`. |

`sample` contains at most 20 keys and never object content. A POST without the exact
`confirm` value is a 400 and deletes nothing.

## 6. UI/UX

No new page in this feature. The report is operational and reached through the API, in
keeping with F56 where platform status is owner-only. A surfaced page can follow if the
numbers prove worth watching.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/r2-retention.test.ts` | Referenced objects are never selected; unreferenced-but-recent objects are never selected; pagination across cursors; bounded batch size; idempotent re-run. |
| Unit | `tests/unit/lib/email/inbound.test.ts` | Raw object deleted and `raw_r2_key` cleared after successful storage; not deleted when storage fails. |
| Unit | `tests/unit/app/api/admin/r2-retention/route.test.ts` | Owner-only, report deletes nothing, delete requires exact confirmation, non-owner denied. |
| E2E | — | Not applicable; no user-visible surface. |

## 8. Current Behavior

`storeRawToR2` writes before routing is known. `processInboundMessage` returns early when
`mailboxTargets.length === 0`, leaving the object unreferenced. Successful processing stores
`raw_r2_key` and never revisits it. F55, F57, and the draft upload route each compensate
their *own* partial failures, so in-flight failures are already handled; what is missing is
the terminal state for objects that were written correctly and later became unreferenced.

## 9. Error States

| Condition | Result | Logged? |
|-----------|--------|---------|
| R2 delete fails after successful processing | Processing still succeeds; the object is caught by the sweep after the retention age | Yes, key only |
| Sweep cannot list R2 | Reported as an error; nothing deleted | Yes |
| POST without exact confirmation | 400, nothing deleted | No |
| Object deleted between report and delete | Treated as success; R2 delete is idempotent | No |

## 10. Edge Cases

- An object written seconds before a sweep must never be deleted; the age bound is what makes the unreferenced check safe against in-flight writes.
- A message in Trash still exists, so its attachments stay referenced and retained.
- Re-running the sweep is safe: deletes are idempotent and the second run finds nothing.
- The sweep must page through R2 cursors; a single list call does not see the whole bucket.
- Keys outside the two known prefixes are never deleted, so unrelated future use of the bucket cannot be destroyed by this feature.

## 11. Permissions & Security

- Report and delete are owner-only, platform-wide, and expose no message content — counts, sizes, timestamps, and key names only.
- Key names embed a user id and message id, so the sample is limited and the endpoint stays owner-only.
- The scheduled sweep performs no authorization of its own and must therefore never be reachable from a request path.

## 12. Open Questions / Decisions

- Decision: delete raw MIME after successful processing rather than retaining it, because nothing reads it back today. — 2026-07-25
- Decision: retain unstored raw for 7 days, so a "my mail vanished" report stays diagnosable for a week. — 2026-07-25
- Decision: derive age and referencedness from R2 and existing D1 columns instead of a retention ledger, to keep an extra write out of the inbound hot path. — 2026-07-25
- Decision: the scheduled sweep ships disabled and deletes nothing until an operator has seen the report, because the existing production backlog would otherwise be removed automatically on the first run. — 2026-07-25

## 13. Bug / Change Log

### 2026-07-25 — Give every R2 object an intentional terminal state

Type: Bug Fix

Summary:

- Delete the raw inbound object after successful processing and clear `message_bodies.raw_r2_key` first, so no row names a missing object.
- Add `src/lib/r2-retention.ts`: find, report, and delete objects that are unreferenced in D1 *and* older than the 7-day retention age, paging through R2 cursors under only the `inbound/` and `attachments/` prefixes.
- Add owner-only `/api/admin/r2-retention` with a dry-run report and a delete guarded by an exact `confirm` value.
- Add a scheduled sweep to the existing cron, gated by `R2_SWEEP_ENABLED` and shipped disabled.

Reason:

- Unroutable, rejected, and (since F62) forward-only mail wrote a raw object that nothing referenced and nothing deleted. Draft deletion and mailbox-delete cascades left attachment objects behind the same way. Tracked as R-11.

Impact:

- Storage is bounded going forward without any change to how mail is delivered.
- The raw MIME of successfully stored messages is no longer available. Nothing reads it today, but adding a "download original" feature later would require revisiting §2.
- The existing production backlog is untouched until an operator reviews the report and enables the sweep.

Tests:

- 15 retention cases covering referenced-never-selected, recent-never-selected, cursor pagination, the scan budget, prefix restriction, idempotent re-run, a null reference row, the default clock, and a failed delete leaving the object for the next run.
- 3 inbound cases: deleted and dereferenced on success, retained when nothing stored the message, and processing still succeeding when R2 delete fails.
- 8 admin route cases including owner-only access and exact-confirmation enforcement.
- `npm run verify` passes with 1,377 tests across 158 files at 100% configured coverage plus all 16 bridge tests.

Notes:

- Four inbound filter assertions asserted "no updates happened" and were scoped to the messages table, because clearing the raw key is now an expected additional update.
- `raw_r2_key` was documented on `messages` in the first draft of this spec; it is on `message_bodies`. Corrected before implementation.
- The first full run failed the branch gate at 99.9%: the nullable-key guard and the default-clock fallback were unexercised. Both are now covered by tests rather than suppressed with ignore comments.
- Not deployed. The report has not been run against production, so the size of the existing backlog is still unknown.
