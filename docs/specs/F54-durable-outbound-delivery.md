# F54 — Durable Outbound Delivery

> Status: `Shipped`
> Owner area: `src/lib/email/send.ts`, `worker.ts`, outbound queue configuration, sent-message UI

## 1. Problem and user job

Lumimail creates an `outbound_jobs` row with status `queued`, but `sendEmail()` then
calls the configured provider synchronously inside the HTTP request. The configured
`OUTBOUND_QUEUE` producer and consumer are not used. A slow or temporarily
unavailable provider therefore blocks the request, and the existing queue retry
settings provide no durability or duplicate protection.

The Sent page only requests rows whose status is `sent`, so queued and failed
outbound messages are invisible even though those states exist in the schema.

**User job:** when I submit an email, Lumimail should accept it durably, deliver it
in the background, avoid duplicate sends, and show whether it is queued, sent, or
failed.

## 2. Current behavior

- Browser and API-key send routes authorize the sender and call `sendEmail()`.
- `sendEmail()` stores the message, body, and outbound job, then calls the provider
  before returning.
- Provider success changes both rows to `sent`; provider failure changes both rows
  to `failed` and returns HTTP 500.
- `processOutboundQueue()` calls `sendEmail()` again, which creates a second message
  and job rather than processing the queued row.
- The queue Worker retries every thrown outbound error without distinguishing
  permanent from transient failures.
- No outbound dead-letter queue or terminal dead-letter handler is configured.

## 3. Desired behavior

### Producer transaction

1. Authorize the user and requested mailbox before accepting the send.
2. Resolve and persist the canonical sender, message body, and an outbound job.
3. Put only `{ kind: "outbound", jobId }` on `OUTBOUND_QUEUE`; message content and
   credentials must not be copied into the queue body or logs.
4. Return HTTP 202 with `{ messageId, status: "queued" }` after the queue accepts
   the job.
5. If enqueueing fails, mark the persisted job and message `failed`, emit one
   `message.failed` webhook, and return an error. Never claim provider delivery
   occurred.

### Consumer transaction

1. Validate the queue payload and load the persisted job snapshot.
2. Atomically claim a `queued` job by changing it to `processing`, incrementing
   `attempts`, and recording the Cloudflare queue message ID as its delivery token.
3. A job already marked `sent` or `failed` is acknowledged without calling the
   provider.
4. A duplicate queue message that cannot claim a job is acknowledged without
   calling the provider.
5. On provider success, mark the job `sent` before updating the visible message
   `sent`. Store the provider message ID and emit `message.outbound`.
6. On a classified transient provider failure, return the job to `queued` and ask
   Cloudflare Queues to retry it with bounded delay.
7. On a permanent provider failure, mark the job and message `failed`, emit
   `message.failed`, and acknowledge the queue message.
8. When retries are exhausted, the configured dead-letter consumer marks the job
   and message `failed` and emits `message.failed`.

### Duplicate-safety boundary

Cloudflare Queues provides at-least-once delivery, while the email providers do not
provide a shared transactional commit with D1. Lumimail therefore uses an
**at-most-once provider claim**:

- the conditional D1 claim prevents ordinary duplicate queue deliveries and
  concurrent deliveries from calling the provider twice;
- if execution terminates after the provider accepted the email but before D1 can
  record success, a redelivery with the same delivery token marks the outcome as
  failed/unknown and does not call the provider again.

This favors avoiding duplicate email over silently retrying an ambiguous provider
outcome. The UI and stored error must make that uncertainty visible.

### User-visible state

- Sent-folder queries include outbound `queued`, `sent`, and `failed` messages.
- The row badge displays the delivery status, not merely `outbound`.
- A visible Sent page refreshes while it contains queued messages.
- Compose success copy says the message was queued, not already delivered.

## 4. Data model

`outbound_jobs.status` adds `processing`.

New columns:

| Column | Type | Purpose |
|---|---|---|
| `attempts` | integer, default 0, not null | Number of provider claims |
| `delivery_token` | text, nullable | Queue message ID holding the provider claim |
| `last_attempt_at` | integer timestamp, nullable | Operational visibility and recovery |

Add an index on `(status, updated_at)` for failed/stuck-job inspection.

## 5. API contract

`POST /api/send` and `POST /api/v1/send`:

- success: HTTP 202 and `{ success: true, data: { messageId, status: "queued" } }`;
- unauthorized sender: existing 404 behavior;
- validation/rate-limit errors: existing behavior;
- persistence or enqueue failure: HTTP 500 with no provider call.

The API does not wait for provider delivery. Final state is read through the
existing mailbox-scoped message APIs.

## 6. Error classification

- Retryable: provider rate limiting, provider/server 5xx responses, and network
  transport failures known not to contain a successful provider response.
- Permanent: validation, sender/domain configuration, recipient suppression,
  malformed content, and other provider 4xx responses.
- Unknown or ambiguous errors fail closed unless explicitly classified retryable.
- Stored/logged errors contain a bounded diagnostic message and provider code only;
  never body content, secrets, authorization headers, or the full provider response.

## 7. Permissions and security

- Sender and mailbox capability checks occur before persistence and enqueueing.
- The consumer sends only the immutable, already-authorized snapshot stored in the
  job. It does not trust sender/message fields from a queue body.
- A user losing mailbox access after acceptance does not cancel an already queued
  email.
- Message and final-state reads continue to use mailbox access conditions.
- Queue and error logs must not include message bodies or credentials.

## 8. Edge cases

- Missing/malformed queue payload: acknowledge after a structured metadata-only log.
- Missing job or deleted message: acknowledge without sending.
- Replayed job after `sent`/`failed`: acknowledge without sending.
- Concurrent duplicate: only the conditional `queued -> processing` winner sends.
- Enqueue failure after persistence: visible failed row and one failure webhook.
- Provider success followed by message-row update failure: the job remains `sent`,
  so redelivery cannot resend; reconciliation may repair the visible message.
- Webhook failure must not retry provider delivery.
- Dead-letter delivery is idempotent and cannot overwrite `sent`.

## 9. Test plan

### Unit

- Producer persists and enqueues without calling the provider.
- Producer enqueue failure marks both rows failed.
- Consumer claims and sends one persisted job.
- Sent/failed/duplicate/missing jobs never call the provider.
- Retryable errors reset to queued and request a retry.
- Permanent errors become failed and are acknowledged.
- Dead-letter processing marks a queued job failed but preserves a sent job.
- Cloudflare and Resend errors are classified correctly.
- Sent query parameters include all delivery states and badges expose status.
- Sent polling occurs only while visible and queued work is present.

### Migration

- Fresh and upgraded schemas contain the new columns/index and accept `processing`.

### Browser

- A submitted message receives queued acknowledgement.
- Sent view renders queued and failed badges and refreshes queued state.

### Release

- `npm run verify`
- relevant Chromium E2E scenarios
- OpenNext production build and Wrangler dry run
- production migration/deployment
- controlled successful send and controlled terminal/retry observation

## 10. Decisions

- Use the existing Cloudflare Queue rather than adding a library or Workflow.
- Keep provider delivery as a single queue step; attachments will extend the stored
  job snapshot under F20.
- Prefer duplicate prevention over automatic retry after an ambiguous provider
  acceptance.
- Configure a dedicated outbound DLQ and consume it with the same Worker.

## 11. Open questions

None blocking implementation. A future operator-facing retry button requires a new
explicit send attempt and is outside this feature.

## 12. Bug / change log

### 2026-07-24 — Durable queue producer and consumer

Type: `Correctness / reliability`

Summary:
- Changed browser and API-key sends to persist an immutable job snapshot, enqueue
  only its job ID, and return HTTP 202 with a truthful `queued` state.
- Added conditional D1 job claims, attempt/delivery-token tracking, provider error
  classification, retry delay, permanent failure handling, ambiguous-crash
  duplicate prevention, and idempotent dead-letter finalization.
- Added a dedicated outbound DLQ to both the production-local Wrangler configuration
  and the committed example configuration.
- Made queued and failed outbound messages visible in Sent, with bounded refresh
  while queued work remains.
- Changed compose acknowledgement copy in all locales from “sent” to “queued” and
  repaired the invalid ICU recipient placeholder found during browser verification.

Verification:
- `npm run verify`: 139 application test files, 1,153 tests, 100% statement,
  branch, function, and line coverage; all 16 bridge tests passed. Lint reported
  35 pre-existing warnings and zero errors.
- Complete Chromium run: all 35 scenarios passed, including queued-to-sent refresh
  and failed-state rendering. The command remained open until timeout because the
  known local Wrangler remote-proxy helper did not shut down.
- Final OpenNext production build passed and wrote `.open-next/worker.js`.
- Wrangler 4.113.0 dry run passed with the production Email, inbound/outbound Queue,
  D1, R2, Images, Assets, and service bindings.

Production evidence:
- Migration `0012_add_outbound_delivery_claims.sql` applied successfully to
  `lumimail-prod`; the remote migration ledger reports no pending migrations and
  schema inspection confirms all claim/attempt columns.
- Created `lumimail-outbound-dlq-prod` and deployed one consumer each for the inbound,
  outbound, and outbound-DLQ queues.
- Worker `70e646ad-809e-45b2-8d13-4e0b03c28563` introduced durable delivery; follow-up
  Worker `73a3d71a-411b-4de7-8ada-0e1decdf39e1` retained the same queue topology while
  correcting a floating language-control overlap found during the send trace.
- A controlled message from `admin@lucidkith.com` to the operator's established test
  recipient was accepted through the production composer, removed its saved draft,
  and reached message/job state `sent` with one provider attempt, a stored provider
  message ID, and no error.
- Duplicate delivery, transient/permanent provider failures, retry delay, ambiguous
  outcomes, and DLQ finalization remain covered by deterministic unit/worker tests.
  A live duplicate injection was not performed because Wrangler 4.113 has no queue
  message-push command and extracting an API credential solely for direct HTTP
  injection would expand the validation's credential-handling risk.

### 2026-07-24 — Durable outbound delivery specification

Type: `Correctness / reliability`

Drafted the queue acknowledgement, D1 claim, retry, dead-letter, idempotency,
failure-visibility, and security contracts before implementation.
