# F08 — Webhook delivery

> Status: Shipped; delivery isolation deployed 2026-09-06
> Owner area: `src/lib/email/webhooks.ts`, `worker.ts`, `webhook_deliveries`

## Current and desired behavior

Before this fix, mail processing inserted a webhook delivery and immediately awaited an external POST with no deadline. One slow subscriber delayed the remainder of a mail queue batch.

Mail processing only persists pending delivery jobs. The existing minute cron delivers at most ten due jobs, in groups of at most three, independently of mail queue processing. Each attempt has a five-second deadline; response bodies are cancelled instead of buffered. No new Cloudflare binding is required.

## Contract and decisions

- Preserve subscribed events, JSON payload and HMAC-SHA256 headers. Add a stable delivery ID header so receivers can deduplicate retries.
- Delivery is asynchronous and at least once. Retry network errors, timeouts, 429 and 5xx up to three attempts, one minute apart. Other HTTP failures are terminal.
- Redirects are refused; the job retries as a network failure rather than forwarding the payload to another destination.
- D1 stores `next_attempt_at`; an atomic conditional update advances attempts and leases a job for one minute. Concurrent cron invocations cannot claim the same attempt. A crashed attempt becomes due after its lease, with three total attempts maximum.
- Recheck that the hook exists and is enabled at delivery time. Disabled/deleted hooks receive no POST. No other user's subscription, credentials or payload is exposed.
- Historical pending deliveries become failed during migration: their prior external delivery outcome is unknown and must not trigger unexpected exports. Newly persisted jobs are due immediately.
- Migration 0041 applies the repository's guarded millisecond-to-second timestamp normalization to `next_attempt_at`. It is separate because migration 0040 has already been applied to local D1.
- An individual webhook failure does not abort other delivery jobs or other scheduled work. No external endpoint is contacted in the mail consumer.
- This isolation applies to scheduled external attempts. Producer-side D1 insertion failures retain the existing fail-fast behavior and can leave earlier subscriptions enqueued. Subscription-count quotas and changing producer persistence semantics are outside this fix.
- No interface for automatic replay of terminal deliveries is added.

## Edge cases and errors

No hooks, disabled/unsubscribed hooks, malformed event configuration, deleted hook, concurrent claims, exhausted crashed leases, network failures, hanging headers, hanging response body, non-2xx, D1 persistence failures and failure while recording an outcome. Failed persistence of a new job remains visible to the existing caller; background delivery failures are isolated and leave retryable state where possible.

## Test plan

Failing regression proving dispatch returns without external fetch; worker cron delegation; real SQLite claim/concurrency and migration tests; signed successful delivery, timeout, retry classification, disabled/deleted hooks, retry exhaustion and per-job failure isolation. Run full verify, existing webhook E2E and full e2e. Production delivery latency/load remains unverified until deployment.

## Bug / Change Log

### 2026-09-05 — Isolate slow webhook endpoints

Type: Performance Fix. Move external POSTs out of the mail path into bounded scheduled delivery jobs. Real SQLite tests cover isolation, concurrent claims, backoff, exhaustion and due selection. Deadline and response cancellation tests pass. Migrations 0040–0041 applied successfully to local D1; remote migration and deployment were not attempted. `npm run verify` passes: 2,713 application tests, 100% configured coverage, the complexity gate, and 21 bridge tests. The complete 105-test browser suite passes. Production delivery latency/load remains unverified.

### 2026-09-06 — Production rollout of backend review fixes

- Built successfully with OpenNext and deployed Worker version
  `3e2a434f-5cb1-4320-b195-8890b67a9605` to `https://mail.henriksen.dev`.
- Applied production migrations 0040–0041. The remote doctor confirms no pending
  migrations, exact active-version bindings, seven queues, and the live minute cron.
- Public smoke: 8/8 passed. Remote doctor: 26 passed, zero failures or warnings.
- This rollout includes sender authorization, shared outbound quotas, first-owner
  registration, bounded pagination/D1 parameters, sequential external sync, and
  scheduled webhook isolation (F04/F05/F06/F74/F89/F93).
- Previous active version: `2b68803a-6c04-4d50-822d-75648dc0f157`. The pre-migration
  D1 Time Travel bookmark is recorded in `.wrangler/production-bookmark-before.json`.
  These additive schema changes retain old-code compatibility; reverting code
  would reintroduce the reviewed defects and would not restore historical webhook
  delivery statuses changed by migration 0040.
- Authenticated mail-send/provider exercises and production memory/load measurements
  were not performed during this deployment. Local regression evidence above remains
  distinct from the live smoke and infrastructure checks.
