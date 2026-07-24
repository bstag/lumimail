# F56 — Queue Health Monitoring

> Status: `Shipped`
> Owner area: Worker scheduled handler, Cloudflare Queues, D1 operational
> snapshots, `/queue-health`, `/api/admin/queue-health`

## 1. Problem and user job

Lumimail's inbound and outbound delivery paths depend on Cloudflare Queues. A
queue can accumulate delayed work or be administratively paused while the web
interface still appears healthy. Today an operator must open the Cloudflare
dashboard or use Wrangler to discover that condition.

**User job:** as the owner of a self-hosted Lumimail deployment, I want a simple
status page that is refreshed automatically and tells me whether email queues are
healthy, delayed, or require intervention.

## 2. Current behavior

- The Worker has email, queue-consumer, and fetch handlers but no scheduled
  handler.
- `INBOUND_QUEUE` and `OUTBOUND_QUEUE` are producer bindings. The outbound
  dead-letter queue is configured only as a consumer.
- Queue health is not persisted or exposed by an authenticated application route.
- A paused queue continues accepting messages and remains paused until an
  operator explicitly resumes it.
- The UI does not show queue backlog, oldest-message age, or dead-letter work.

## 3. Desired behavior

### Scheduled check

- A Cloudflare Cron Trigger invokes the Worker every minute.
- Each check requests real-time metrics for the inbound, outbound, and outbound
  dead-letter queues through Queue bindings.
- The dead-letter queue receives a producer binding solely so the Worker can call
  its read-only `metrics()` method.
- The checker persists one current D1 snapshot per queue. A newer check replaces
  the prior snapshot; this feature is current-state monitoring, not time-series
  analytics.
- One queue metric failure does not prevent the other queues from being checked.
- The scheduled handler awaits the complete check so writes and errors are
  accounted for during the Worker invocation.

### Status classification

Each queue has one of these states:

| State | Meaning |
|---|---|
| `healthy` | No queued work and no application-level stale outbound jobs |
| `delayed` | Work is queued but its oldest item is younger than two minutes |
| `attention` | Oldest queued work is at least two minutes old, the dead-letter queue contains work, or outbound D1 jobs are stale |
| `unavailable` | Cloudflare metrics could not be read |

Outbound application state is an additional signal:

- `queued` jobs updated at least two minutes ago are stale.
- `processing` jobs updated at least ten minutes ago are stale.
- Stale job counts affect the outbound queue's state and are shown on the page.
- Failed jobs are already visible in Sent and are not counted as queued backlog.

Queue metrics cannot report Cloudflare's administrative `delivery_paused` flag.
The application detects the operational effect of a pause through an aging
backlog or stale outbound job, and says so explicitly. Reading or changing the
pause flag would require broader Cloudflare Queues API permission and is outside
this feature.

### Owner page

- `/queue-health` is linked from the administration navigation.
- The page displays all three deployment-wide queues, their state, queued message
  and byte counts, oldest-message time/age, stale outbound jobs where applicable,
  last check time, and a bounded safe error when metrics are unavailable.
- It displays a prominent warning when the latest complete check is older than
  three minutes or snapshots do not exist.
- It explains that health is platform-wide and not scoped to the currently
  selected mailbox or domain.
- It includes a manual **Check now** action for validation and incident response.
- The page does not expose message bodies, addresses, queue payloads, provider
  responses, credentials, account IDs, or binding names.

## 4. API contract

`GET /api/admin/queue-health`

- Requires an authenticated organization owner.
- Returns the latest snapshots in a fixed queue order.
- Returns an empty snapshot list before the first successful check.
- Does not contact Cloudflare Queues.

`POST /api/admin/queue-health`

- Requires an authenticated organization owner.
- Runs the same checker used by the Cron Trigger and returns the resulting
  snapshots.
- Concurrent or repeated checks are safe because snapshots are upserted by a
  fixed queue key.

Both methods return:

```json
{
  "queues": [
    {
      "queue": "inbound",
      "label": "Inbound mail",
      "status": "healthy",
      "backlogCount": 0,
      "backlogBytes": 0,
      "oldestMessageAt": null,
      "staleJobCount": 0,
      "detail": null,
      "checkedAt": "2026-07-24T12:00:00.000Z"
    }
  ]
}
```

Unauthorized, missing-organization, admin, and member sessions fail through the
existing owner guard with HTTP 401 or 403. Operational failures are represented
per queue rather than turning a partial check into an unbounded HTTP 500.

## 5. Data model

`queue_health_snapshots` contains:

- `queue_key` primary key: `inbound`, `outbound`, or `outbound_dlq`
- `status`: `healthy`, `delayed`, `attention`, or `unavailable`
- `backlog_count` and `backlog_bytes`, both non-negative integers
- nullable `oldest_message_at`
- `stale_job_count`, a non-negative integer
- nullable bounded `detail`
- `checked_at`

The table is deployment-level and deliberately has no organization or mailbox
foreign key because the configured Cloudflare queues are deployment-level.

## 6. Error and edge behavior

- A metrics exception is converted to an `unavailable` snapshot with zero
  unknown numeric values and a generic, bounded detail. Raw provider responses
  and credentials are not stored.
- A future-dated oldest timestamp is treated as age zero.
- A non-empty backlog without a usable oldest timestamp requires attention
  because its delay cannot be established safely.
- Negative or non-finite metric values are normalized to zero.
- Dead-letter work is always `attention`, even when newly queued.
- If the D1 stale-job query fails, the outbound snapshot is `unavailable`; other
  queue results remain usable.
- If persisting the snapshots fails, the scheduled invocation fails and logs a
  safe summary so Cloudflare observability records the unsuccessful check.
- Cron changes can take up to 15 minutes to propagate after deployment; the
  manual check allows immediate validation.
- A stopped Cron Trigger is detected by page freshness rather than by a second
  monitor that depends on the same Worker.

## 7. Security and privacy

- Only organization owners can access the operational API/page; admins and
  members cannot.
- Results are aggregate deployment-level counts. No tenant-owned row, address,
  subject, payload, or message identifier is returned.
- The checker uses bound resources only and sends no health data outside the
  deployed Cloudflare environment.
- This feature neither pauses, purges, resumes, retries, nor publishes queue
  messages.
- Adding a metrics-capable dead-letter binding does not authorize any application
  path to send to it; it is used only by the checker.

## 8. Test plan

### Unit/integration

- Classify empty, young backlog, old backlog, dead-letter backlog, unavailable
  metrics, future timestamps, and stale outbound jobs.
- Prove one metrics failure does not suppress other queue snapshots.
- Prove safe normalization and bounded error detail.
- Prove the checker upserts a fixed current snapshot for every queue.
- Prove GET and POST require an owner and return the fixed public shape.
- Prove the Worker scheduled handler invokes and awaits the checker.
- Prove executable migration output matches the Drizzle schema.

### Browser

- Owner can open `/queue-health`, see three queue cards, and manually refresh.
- Admin/member direct navigation is rejected by the existing admin guard.
- Missing/stale checks and attention states have readable, non-overlapping
  responsive layouts.

### Deployment validation

- Apply migration `0013`.
- Deploy the Worker and confirm the Cron Trigger is registered.
- Run **Check now** and confirm fresh snapshots for all three queues.
- Allow at least one scheduled interval, reload, and confirm `checkedAt` advances
  without manual action.
- Do not intentionally pause or enqueue production messages for validation.

## 9. Decisions and non-goals

- Thresholds are fixed MVP operational defaults rather than user settings.
- Snapshots are deployment-wide because Cloudflare queue bindings are
  deployment-wide.
- Owners can observe but cannot resume/purge queues from Lumimail.
- Exact `delivery_paused` inspection, automatic remediation, alert delivery,
  historical charts, and per-domain queue isolation are follow-up work.

## 10. Bug / Change Log

- 2026-07-24 — Drafted scheduled queue checks and owner-only operational status
  page after a production outbound queue was found administratively paused.
- 2026-07-24 — Implemented the scheduled checker, D1 current snapshots,
  owner-only API/page, manual check, stale-job signal, example deployment
  configuration, and deterministic unit/API/browser coverage. Local migration,
  full verification, production build, and Wrangler dry run pass; production
  rollout evidence remains pending.
- 2026-07-24 — Production migration `0013` applied and Worker version
  `32a2f078-ee99-47d8-a4c2-7c90d12bc84e` deployed at 100%. Version inspection
  confirmed the scheduled handler and all three Queue bindings. D1 contained
  fresh, healthy scheduled snapshots for inbound, outbound, and outbound DLQ
  before any manual action. The owner page rendered all three healthy states,
  and **Check now** advanced every timestamp with zero backlog, dead letters, or
  stale outbound jobs.
