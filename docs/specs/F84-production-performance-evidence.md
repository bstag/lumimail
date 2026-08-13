# F84 — Production Performance Evidence

> Status: In Progress — production HTTP and managed-D1 pass; controlled Queue batch remains
> Owner area: `scripts/performance-evidence.mjs`, production D1/HTTP/Queue evidence, `docs/OPERATIONS.md`

## 1. Problem & User Job

F66 proves indexed query plans and bounded local SQLite costs, but the remaining MVP gate asks a
different question: whether the deployed Worker, managed D1, and Cloudflare Queues meet explicit
production-shape targets. Local timings cannot answer that, and ad-hoc browser impressions are not
repeatable evidence.

An operator needs one bounded, content-free command for deployed read latency and a separate,
explicitly authorized Queue batch that proves throughput without turning production into a load-test
target or exposing mailbox data.

## 2. Desired Behavior

- Measure a fixed allowlist of authenticated, read-only production endpoints serially.
- Warm each endpoint once, then record exactly 15 samples using one owner session.
- Require HTTPS, successful expected statuses, JSON responses, a bounded per-request timeout, and
  no redirects.
- Report only endpoint labels, status, sample count, p50/p95/maximum milliseconds, targets, outcome,
  origin host, and observation time. Never retain response bodies, session tokens, object keys,
  mailbox/message/user IDs, addresses, cookies, or headers.
- Keep direct managed-D1 timing and Queue throughput as separate evidence classes; an HTTP pass does
  not imply either one passed.
- Refuse arbitrary URLs, methods, request bodies, concurrency, sample counts, or target overrides.

## 3. Initial Targets

Targets describe a small self-hosted MVP from the operator's network, including network and Worker
time. They are intentionally generous enough for managed-service variance while still catching
multi-second regressions.

| Read path | Expected | p95 target |
|---|---:|---:|
| Session resolution `/api/auth/me` | 200 | 1,000 ms |
| Mailbox list `/api/mailboxes` | 200 | 1,000 ms |
| Domain list `/api/domains` | 200 | 1,500 ms |
| Routing rules `/api/routing-rules` | 200 | 1,500 ms |
| Queue health `/api/admin/queue-health` | 200 | 1,500 ms |
| R2 retention report `/api/admin/r2-retention` | 200 | 3,000 ms |

Every sample must return the expected status. The command fails if any endpoint exceeds its p95
target or if measurement integrity fails.

## 4. Managed D1 Evidence

Use Wrangler's remote D1 execution for a fixed, read-only aggregate/query-plan bundle. Record only
table counts, plan/index names, Cloudflare-reported SQL duration/region, and rows read/written. The
run must show zero rows written. Do not select message content, subjects, snippets, addresses,
credentials, token material, or object keys.

F66's eight local query targets and plan assertions remain the regression contract. F84 adds managed
service evidence; it does not replace them with unstable wall-clock unit tests.

## 5. Queue Throughput Evidence

Queue evidence is a separate controlled production operation because it sends real mail. Before the
batch, record zero/known backlog and dead-letter state. Submit a small fixed batch through an owned
mailbox to an operator-approved recipient, record acceptance and terminal timestamps by content-free
job identifiers, and prove:

- all accepted jobs reach `sent` exactly once;
- no job reaches the DLQ or remains stale;
- at least five jobs complete within 120 seconds of the first acceptance; and
- production smoke and queue health pass afterward.

The command added in this slice does not send mail. The Queue batch requires separate operator
approval for recipient and batch timing.

## 6. Scope Boundaries

In scope:

- Content-free, bounded HTTP latency measurement.
- Read-only managed-D1 aggregate and plan evidence.
- A documented contract for the later controlled Queue batch.

Out of scope:

- Public benchmarking, stress testing, concurrent load generation, synthetic tenant seeding, or
  changing production data volume.
- Changing indexes, caching, pagination, Queue configuration, or performance targets after seeing
  results merely to make a run pass.
- Treating Cloudflare dashboard aggregates as proof of application correctness.

## 7. Error States and Edge Cases

| Condition | Result |
|---|---|
| Missing/malformed session token | Fail with bounded guidance; never print it |
| Non-HTTPS or non-origin URL | Refuse before network access |
| Redirect, timeout, wrong status, or non-JSON body | Fail that endpoint and the run |
| A later sample fails after earlier successes | Preserve only timing/status summaries; fail run |
| p95 is exactly the target | Pass |
| Fewer/more samples than the fixed contract | Refuse through the public command surface |
| Response contains private data | Parse/discard in memory; never include it in output |

## 8. Test Plan

| Layer | File | Coverage |
|---|---|---|
| Unit | `tests/unit/scripts/performance-evidence.test.ts` | strict origin/token, fixed endpoint allowlist, serial warmup/samples, timeout/redirect/status/JSON failures, percentile calculation, threshold boundary, content-free output, bounded errors |
| Contract | `tests/unit/scripts/performance-d1-contract.test.ts` | fixed read-only SQL only, prohibited private columns, exact remote Wrangler command |
| Existing regression | F66 tests and `scripts/measure-query-cost.mjs` | local 25,000-message costs and index plans remain passing |
| Full | repository commands | `npm run verify`; no E2E because no product UI changes |

## 9. Decisions and Open Questions

- Decision: measure 15 serial samples after one warmup. This is enough to expose consistent
  regressions without load generation. — 2026-08-13
- Decision: declare targets before the first production run and do not accept CLI overrides. —
  2026-08-13
- Decision: keep response bodies and identifiers out of evidence even though the authenticated APIs
  return them. — 2026-08-13
- Decision: an already signed-in owner browser may run the same fixed serial GET series when a CLI
  process cannot inherit its cookie. Record the transport explicitly. Navigation timing is
  conservative because it includes browser/control overhead; the token-based CLI remains the
  repeatable operator command. — 2026-08-13
- Open: the operator must approve the Queue batch recipient and timing before real mail is sent.

## 10. Bug / Change Log

### 2026-08-13 — Specify bounded production performance evidence

Type: Operational evidence

- Define fixed authenticated HTTP paths, sample counts, targets, privacy bounds, managed-D1 proof,
  and a separately authorized Queue batch.
- Start with a read-only command so latency evidence can advance without sending mail or mutating
  production.
- Implement `npm run performance:measure -- <https-origin>` with six fixed paths, one warmup and 15
  serial samples per path, fixed p95 targets, strict HTTPS/session handling, and content-free output.
- Implement `npm run performance:d1` as eight individually executed remote `--command` queries.
  Wrangler's `--file` path was rejected after it warned that import could temporarily make D1
  unavailable; no SQL executed through that failed attempt. The final command never uses import.
- Focused tests pass 30/30 across the HTTP command, D1 runner, and read-only SQL contract.
- Production D1 evidence at `2026-08-13T22:37:26.315Z` ran in WNAM: eight statements, 2.485 ms total
  Cloudflare-reported SQL duration, 106 rows read, and zero written. The production shape is four
  domains, four users, four mailboxes, 44 messages, four attachments, three routing rules, five
  sessions, and 16 outbound jobs. All four hot plans use their intended indexes.
- Historical outbound rows are not treated as throughput proof: all 16 are sent with zero failed,
  but `updated_at - created_at` includes operator/recovery delays (131.375-second average and
  1,863-second maximum), so only a controlled batch can establish Queue throughput.
- Owner-authenticated Chrome navigation evidence at `2026-08-13T22:45:43.974Z` passed all six
  targets with 15 serial samples after warmup: session p50/p95 354/387 ms, mailboxes 331/528 ms,
  domains 322/358 ms, routing 331/369 ms, queue health 331/385 ms, and R2 retention 632/718 ms.
  Every response matched its authenticated success shape. These conservative timings include browser
  control/navigation overhead; no response body, identifier, address, or cookie entered the report.
