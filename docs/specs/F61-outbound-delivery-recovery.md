# F61 — Operator-Confirmed Outbound Delivery Recovery

> Status: In Progress
> Owner area: `src/lib/email/send.ts`, `src/app/api/messages/[messageId]/retry/`, Sent message UI

## 1. Problem & User Job

F54 made outbound delivery durable: sends are queued, claimed at most once, retried on
classified transient errors, and finalized in a dead-letter queue. What it never added
was a way back. `processOutboundDeadLetter` marks the job `failed` and stops there, and
no requeue, resend, or recovery path exists anywhere in `src/`.

The practical consequence is that every terminal failure is permanent. A send that failed
because a sending domain was briefly misconfigured, an API token had expired, or the queue
was administratively paused stays failed after the operator fixes the cause. The only
workaround is to compose the message again from scratch, which loses the original
threading headers and attachments.

A user who can send from a mailbox needs to return a failed message to the delivery queue
after resolving the cause, without risking a duplicate send.

## 2. User Stories & Acceptance Criteria

- As a user with send capability on a mailbox, I can retry a failed outbound message from that mailbox.
- Given a message whose outbound job is `failed`, when I confirm retry, then the job returns to `queued`, the message returns to `queued`, and the queue receives the job.
- Given a retried job, when the queue consumer claims it, then delivery proceeds through the ordinary at-most-once claim with no separate code path.
- Given I retry the same message twice, when the second request arrives, then it is rejected because the job is no longer `failed`, and the queue receives it only once.
- Given a message whose job is `queued`, `processing`, or `sent`, when retry is requested, then it is rejected.
- Given I have read but not send capability on the mailbox, when retry is requested, then it is denied exactly as sending is denied.
- Given a message in another organization or another user's unrelated mailbox, when retry is requested, then it is not found.
- Given the queue is unavailable at retry time, when the send fails, then the job returns to `failed` and the operator sees an unchanged failed state rather than a silently lost message.
- As an operator, I can see that a message was recovered and how many times.

## 3. Scope Boundaries

**In scope:**

- A conditional `failed` → `queued` transition on `outbound_jobs`, guarded by the existing status column.
- One authenticated, send-capability-scoped endpoint to request recovery.
- Re-enqueueing the existing job ID so the stored payload, threading headers, and attachment metadata are reused unchanged.
- Recovery audit columns and their migration.
- A Sent-folder affordance that requires explicit confirmation and states the duplicate risk.

**Out of scope:**

- Automatic or scheduled recovery. Recovery is operator-initiated by decision; see §12.
- Verifying with the provider whether an ambiguous failure already delivered. This is the accepted limitation of the chosen model; see §12.
- Editing message content before retrying. Recovery re-sends the stored payload as authored.
- Recovering a job whose message row was deleted. `outbound_jobs.message_id` is `set null` on delete, and there is nothing left to authorize or display.
- Bulk recovery of many failed messages at once.
- Changing dead-letter queue topology, retry classification, or backoff from F54.

## 4. Data Model

`outbound_jobs` gains two columns in migration `0017`:

| Column | Type | Null | Default | Purpose |
|--------|------|------|---------|---------|
| `recovered_at` | integer timestamp | yes | null | When the job was most recently returned to the queue by an operator. |
| `recovery_count` | integer | no | `0` | How many times an operator has recovered this job. |

No existing column changes meaning. `attempts` continues to accumulate across recoveries so
the total provider attempt history stays visible; `recovery_count` distinguishes operator
action from automatic retries.

## 5. API Contract

`POST /api/messages/{messageId}/retry`

- Auth: session cookie or Bearer API key, same as other mailbox-scoped message routes.
- Authorization: `messageAccessCondition(db, userId, organizationId, "send")`, identical to draft and compose authorization in F48.
- Request body: none.

Responses use the existing `apiSuccess`/`apiError` envelopes from F40, so errors are
`{ success: false, error: { message } }`.

| Condition | Status | Body |
|-----------|--------|------|
| Recovery accepted and enqueued | 202 | `{ success: true, data: { messageId, status: "queued" } }` |
| No failed job for a visible message | 409 | `error.message` = `Message is not in a failed state` |
| Message not visible, absent, or send capability missing | 404 | `error.message` = `Message not found` |
| Unauthenticated | 401 | `guardUser` response |
| Queue rejected the job | 503 | `error.message` = `Queue unavailable` |

404 rather than 403 for a missing capability matches the existing mailbox-scoped routes and
avoids confirming that a message exists in a mailbox the caller cannot send from.

## 6. UI/UX

In the Sent folder, a row whose status badge is `failed` gains a **Retry delivery** action.
Choosing it opens a confirmation that names the recipient and subject and states plainly
that if the original attempt reached the provider before failing, retrying can deliver the
message twice. Only explicit confirmation issues the request.

After a successful retry the badge returns to `queued` and the existing Sent-folder refresh
from F54 resumes polling, because queued work is present again.

The action is absent for viewer-capability users, consistent with F48 hiding send
affordances rather than showing controls that the API will refuse.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/email/recovery.test.ts` | Conditional transition from `failed` only; queued/processing/sent rejected; audit columns advance; queue send failure reverts to `failed`. |
| Unit | `tests/unit/app/api/messages/retry-route.test.ts` | 202/409/404/401 contract, send-capability requirement, cross-tenant denial, and single enqueue under duplicate requests. |
| Unit | `tests/unit/db/migrations.test.ts` | Migration `0017` reaches Drizzle parity on both a fresh and an upgraded database (F42/R-33). |
| Unit | `tests/unit/components/messages/delivery-state.test.ts` | The recovery affordance appears only for a failed Sent message held by a send-capable user. |
| E2E | `tests/e2e/outbound-recovery.spec.ts` | Dismissing the confirmation sends nothing, accepting it issues exactly one request, the disclosure names the recipient and the duplicate risk, and a viewer never sees the control. |

## 8. Current Behavior

`processOutboundDeadLetter` calls `markOutboundFailed`, which sets `status = "failed"`,
clears `delivery_token`, sets the message to `failed`, and dispatches a `message.failed`
webhook. Nothing reads a failed job afterwards. `processOutboundQueue` claims only jobs
whose status is exactly `queued`, so a failed job is unreachable by the consumer.

## 9. Error States

| Condition | Result | Logged? |
|-----------|--------|---------|
| Job is not `failed` when the conditional update runs | 409, no queue send, no state change | No |
| Message hidden by mailbox authorization | 404 before any job read | No |
| `OUTBOUND_QUEUE.send` throws | Job and message return to `failed` with `Queue unavailable`; 503 | Existing queue error path |
| Job exists with a null `message_id` | 404; there is no authorizable message | No |

## 10. Edge Cases

- Two concurrent retries: the conditional update matches once, so exactly one request enqueues and the other receives 409.
- A retry that lands while the dead-letter consumer is still finalizing: the consumer's `markOutboundFailed` only matches `queued` or `processing`, so it cannot re-fail a job that an operator already returned to the queue and the consumer has claimed.
- Recovery of a job whose attachments were removed from R2: the existing consumer check fails the job again with the current missing-attachment error, which is the correct outcome.
- `attempts` is deliberately not reset, so the operator can still see how many provider attempts a message has cost.
- A recovered job that then succeeds keeps its `recovery_count`, so a delivered message still shows it was recovered.

## 11. Permissions & Security

- Recovery requires send capability on the owning mailbox, so it cannot become a way for a
  read-only member to emit mail from a shared mailbox.
- The route performs no mailbox lookup of its own; it reuses `messageAccessCondition` so
  authorization cannot drift from the other message routes.
- Recovery re-sends the stored payload and never accepts caller-supplied content, so it
  cannot be used to send arbitrary mail as another sender.
- No message content, recipient address, or provider error is added to logs by this feature.

## 12. Open Questions / Decisions

- Decision: recovery is operator-confirmed rather than provider-verified. A failure can be
  ambiguous — the provider may have accepted the message before the response was lost — and
  only Resend exposes a lookup usable to disambiguate. Requiring provider verification would
  make recovery unavailable on Cloudflare, the default provider. The duplicate risk is
  therefore accepted and disclosed in the confirmation rather than engineered away. — 2026-07-24
- Decision: reuse the existing job row and payload instead of creating a replacement job, so
  threading headers, attachment metadata, and the message identity stay stable and the
  at-most-once claim needs no new code path. — 2026-07-24
- Decision: no automatic recovery. Automatic requeueing of dead-lettered mail would convert a
  single ambiguous failure into repeated duplicate delivery without anyone deciding to accept
  that risk. — 2026-07-24
- Decision: authorize with send capability rather than organization-admin role, so the person
  who sent the message can recover it without granting broad administrative access. — 2026-07-24

## 13. Bug / Change Log

### 2026-07-24 — Add operator-confirmed recovery for failed outbound delivery

Type: Feature

Summary:

- Add `recoverOutboundJob`, which conditionally moves an outbound job from `failed` back to `queued`, restores the message state, and re-enqueues the existing job ID.
- Add `POST /api/messages/{messageId}/retry`, authorized with send capability on the owning mailbox.
- Add a Sent-folder **Retry delivery** action that requires explicit confirmation naming the recipient and the duplicate risk.
- Add migration `0017` with `recovered_at` and `recovery_count`.

Reason:

- F54 made delivery durable but left every terminal failure permanent. `processOutboundDeadLetter` marked a job `failed` and no recovery path existed, so a send that failed for a since-resolved cause could not be retried. Tracked as R-34.

Impact:

- A send-capable user can return a failed message to the queue without recomposing it, preserving threading headers and stored attachments.
- Duplicate enqueueing is structurally impossible: the `status = "failed"` predicate matches at most once, and delivery still runs through the unchanged at-most-once claim.
- An ambiguous provider failure can still result in a duplicate. This is disclosed in the confirmation rather than prevented; see §12.

Tests:

- `tests/unit/lib/email/recovery.test.ts` (5), `tests/unit/app/api/messages/retry-route.test.ts` (7), and a recovery-visibility case in `delivery-state.test.ts`.
- The unit tests were observed failing before implementation with `recoverOutboundJob is not a function`.
- `npm run verify` passes with 1,300 application tests across 151 files at 100% configured coverage plus all 16 bridge tests.
- Both `tests/e2e/outbound-recovery.spec.ts` Chromium scenarios pass.
- Migration `0017` reaches Drizzle parity on both a fresh and an upgraded database via the F42/R-33 contract.

Notes:

- Deployed. Migration `0017` is applied to `lumimail-prod` with no migrations pending, and version `b16e64d4-31a6-4850-8b55-400a3ff54a30` is live at 89 ms startup with all queue, cron, and domain triggers intact. `GET /` returned 200 and unauthenticated retry returned 401.
- A controlled production recovery of a genuinely failed message remains before this is marked Shipped and before the F54 recoverability gate is checked. The code path is deployed but has not yet moved a real production message from `failed` back to `sent`.
