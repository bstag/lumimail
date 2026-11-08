# F95 — Active Mail Categorization

> Status: In Progress — implemented locally; not deployed or live-provider verified
> Authorized: 2026-10-02
> Owner area: `src/lib/categorization/`, `/insights`, categorization APIs, scheduler
> Builds on: F24 filters, F75 nested personal labels, F89 external-account imports

## 1. Problem & User Job

A user with a large aggregated Gmail inbox needs navigable categories, sender
analysis, historical insight, and a way to tune Jev questions from observed mail.
The user confirmed that Jev means TypeSafe AI and authorized the label-first
workflow, editable questions, sample comparisons, and explicit backfill.

## 2. User Stories & Acceptance Criteria

- Inspect 7/30/90-day totals, weekly volume, personal tag counts, paginated normalized
  senders, and recent examples in the selected mailbox scope.
- Draft an exact-sender rule from an observed source, choose its tag, and review
  mixed content before applying it.
- Create, edit, disable, and remove local rules. Exact parsed address/domain,
  subject substring, and body substring combine with AND, ignoring case. Reject
  empty rules and unsafe domain-suffix matching.
- Edit up to eight Choice/Noul/Score questions: instructions, name, options and
  definitions, tag mapping, ordered score levels, and probability thresholds.
- Compare current/proposed results on up to five recent inbound messages without
  changing mail/configuration. Editing after testing marks the sample stale.
- Activate an immutable version with an optimistic expected-version check. Restore
  an older snapshot as a draft and activate a new version from it.
- Explicitly process existing received/archived inbound mail through bounded,
  resumable jobs with progress, manual advancement, retry, and cancellation.
- Review reasons, version/model, and answers. Personal corrections survive replay;
  clearing a correction restores the recorded automatic result.
- Browse resulting tags through the existing Labels navigation without duplicating
  mail; source grouping remains independent of purpose/category.

## 3. Scope Boundaries

In scope: personal label-only rules, optional Jev evaluation, immutable versions,
samples, sender/date insights, explicit backfill, automatic arrivals, corrections,
original Date retention for new mail, and matching privacy disclosure.

No automatic archive, move, mark-read, delete, or move to Spam. Banking describes
purpose, not authenticity. Users can define additional categories, including a
personal spam tag. Existing F24 destructive filters retain their behavior and are
not replayed over historical imports. Gmail itself is unchanged by local actions.
Two-way Gmail labels, arbitrary-depth folders, training from corrections, automatic
prompt optimization, provider cost accounting, and localized new controls are later
work.

## 4. Data Model

| Table | Purpose |
|-------|---------|
| `categorization_versions` | Immutable user/org configuration snapshots |
| `categorization_preferences` | Active version, automatic start, AI consent, scheduler rotation |
| `categorization_results` | Immutable evaluation per user/message/version; model, answers, reasons |
| `categorization_states` | Latest personal tags/version, system-owned attachment IDs, correction |
| `categorization_jobs` | Scope/version snapshot, ingestion cutoff/cursor, lease, progress, retries |
| `messages.received_at` | Original valid RFC Date; nullable for legacy records |
| Existing labels/attachments | Personal tags and existing browse behavior |

Migrations: `0043_mail_categorization.sql` adds the schema and a partial unique
active-job index per user. `0044_categorization_timestamp_normalization.sql` follows
the append-only normalization contract. Date preservation is wired into native
inbound delivery and external import. Historical dates are not reconstructed.

## 5. API Contract

Session auth uses `withUser`; Zod schemas live in `validators.ts`. F40 envelopes
apply. Foreign mailbox/job/classification IDs return 404.

| Method | Route | Contract |
|--------|-------|----------|
| GET | `/api/categorization` | Active config, readiness, fifty latest snapshots |
| POST | `/api/categorization` | `{ config, expectedVersion, automatic, consent }` |
| POST | `/api/categorization/preview` | `{ config, mailboxId: string or null, consent: true }`; five comparisons |
| GET | `/api/categorization/jobs` | Thirty latest personal statuses; no lease tokens |
| POST | `/api/categorization/jobs` | `{ mailboxId: string or null }`; active version and fixed cutoff |
| POST | `/api/categorization/jobs/[id]` | `{ retry: boolean }`; one five-message batch or reset failed job |
| PATCH | `/api/categorization/jobs/[id]` | `{ cancel: true }` |
| POST | `/api/categorization/corrections` | `{ messageId, tags: string[] or null }`; override or restore |
| GET | `/api/insights` | `days=7/30/90`, offset, optional mailboxId/sender |

Only one pending/running job per user. Corrections allow thirty tag names. Sender
pages and recent messages contain twenty-five entries; top tag counts contain
thirty. Tag counts overlap. Analytics use retained original Date or ingestion time;
sender-supplied dates do not establish trust and future dates are excluded.

## 6. UI/UX

`/insights`: Overview, Questions & rules, Processing. The mailbox picker scopes
insights, samples, and backfill. Navigation reuses the existing mobile drawer;
labels use `/label/[id]`, recent messages `/inbox/[id]`.

Loading, empty, validation, stale-preview, missing-provider, and retryable API states
are visible. AI previews require explicit disclosure consent; automatic AI activation
also requires provider readiness. Rules-only processing works without a key. A
non-automatic AI configuration may be saved without consent, but starting its AI
job requires saved consent.

Statuses poll every five seconds. A button advances batches; the existing minute
scheduler continues jobs after closing the browser. New controls are initially
English; existing locale selection and direction remain intact. Tested at 390 px
without horizontal overflow.

Automatic classification is account/workspace-wide across accessible mailboxes;
the opt-in control explicitly states this. Samples and explicit existing-mail jobs
follow the selected mailbox scope.

## 7. Test Plan & Evidence

| Layer | Coverage |
|-------|----------|
| Categorization engine/provider unit tests | Validation, local matches, every question type, probability/legend errors, bounded requests/responses, fixed HTTPS auth, network failures |
| Real SQLite service tests with all migrations | Isolation, activation races, jobs/leases/retries/cancel, manual-tag/correction preservation, concurrent commit safeguards, viewer grants/revocation, insights |
| API tests | Every route method, auth, invalid requests, rate limits, safe errors |
| Component tests | Queries, disclosure consent, preview/activation, corrections, processing actions |
| Parse/inbound/import tests | Original Date retention and malformed/missing-date fallback |
| Database tests | Fresh/staged migration parity and timestamp normalization |
| Playwright | Sender draft, question tuning/preview/activation, retries/cancel, explanations/corrections, error recovery, mobile |

Focused categorization logic: 34 tests pass with 100% lines/statements/functions/
branches. Five interactive component tests pass. New browser flows: 5/5 pass.
Full `npm run e2e -- --workers=2`: 123/123 pass on 2026-10-02; the five F95 flows
also pass in a focused rerun after the final changes. Local D1 migrations through
0044 pass. Final `npm run verify` passes: typecheck, lint with zero errors and 38
preexisting warnings, 2,841 unit tests, 100% logic coverage in all four dimensions,
the repository-wide CRAP gate, and 21 bridge tests. No real provider key or mail was
used for live evaluation. Deployment and a consented live Jev call remain unverified.

## 8. Current Behavior

Before F95, F24 applied legacy rules to native inbound mail; external imports did
not gain a versioned tuning/classification workflow. Personal nested labels existed.
There was no Jev boundary, insights page, immutable question history, sample
comparison, correction state, or categorization jobs.

Implemented behavior is defined above. Starter questions propose Personal,
Promotions, Newsletters, Updates, Banking, Receipts, Other, Needs reply, and an
urgency score. They remain inactive until a user activates a configuration.

## 9. Error States

| Condition | Result |
|-----------|--------|
| Invalid schema or missing required consent | 400 with validation/actionable message |
| Expired/missing session | Existing 401 behavior |
| Inaccessible/foreign resource | 404 |
| Stale activation or overlapping active job | 409 |
| Preview throttle | 429; five samples/minute/user |
| Missing provider secret or infrastructure failure | 503 without secret/provider/database details |
| Failed provider evaluation in a job | Generic error, bounded backoff; failed after three attempts |

## 10. Edge Cases & Processing Decisions

- Automatic processing starts off. After opt-in, committed inbound mail stored at
  or after the enable time is eligible, including newly imported old mail. Already
  classified messages are excluded; no empty jobs are created without arrivals.
- Explicit jobs snapshot version/cutoff and use ingestion `(createdAt, id)` keyset
  cursors. Replays reuse recorded results for that message/version.
- Five-message batches use conditional durable leases and bounded retries.
  Scheduling rotates users/jobs and processes at most two jobs per minute tick.
- Eligibility is rechecked before each provider call. Cancellation, mailbox read
  access, current user organization, and the prior
  personal state snapshot are checked at commit. Atomic guarded writes preserve
  concurrent corrections. In-flight provider requests can finish without applying
  results after cancellation/revocation. Progress counts visited messages, including
  skipped messages after access changes, rather than claiming all were tagged.
- Disabling automatic work cancels automatic jobs; explicit jobs are independently
  cancellable. A failed automatic job must be retried, cancelled, or superseded by
  activating a replacement configuration before automatic jobs resume. Retrying
  requires an idle job slot. Activation does not rewrite existing classifications.
- Replace only prior system-owned attachments. Unrelated manual labels and other
  users' labels remain. Empty label definitions from an interrupted write can
  remain without any result or message attachment being committed.
- New tags are flat personal labels; the existing manager can nest them. Sender
  groups do not create a label per sender or force a conflicting parent name.
- Sender grouping takes the final bracketed address, so angle brackets in a quoted
  display name do not become false source groups.
- Scores retain metadata without tagging. Choice/Noul thresholds use actual
  selected-option/yes probability, not Jev's differently scaled confidence.
  Weak results retain uncertainty; Other may intentionally map to no tag.

## 11. Permissions & Security

Personal tables scope user plus organization. Message selection/commit use existing
read permissions, including viewer grants. No shared status/folder writes occur.
Revoked messages cannot contribute to samples/insights or acquire tags.

Fixed-origin direct HTTPS uses server-only `TYPESAFE_API_KEY`, a 15-second timeout,
and a 64-KiB response limit. Validate exact keys/types, choices, probability
keys/ranges/sums, and score range/legend. Payload bounds: sender/recipient/subject
500 characters each, plain text or snippet 8,000 characters. No attachments, HTML,
full threads, body logs, or credential disclosure. Stored provenance does not copy
the message body.

AI consent is explicit. The public privacy policy names TypeSafe and links its
policy, preserves Google's Limited Use/no-training commitments, and does not
promise zero provider retention. Corrections do not retrain the hosted model.

## 12. Decisions / Remaining Work

2026-10-02: confirmed TypeSafe AI; label-only scope, pinned `jev-1.13.0`, operator
secret, user consent, and immutable tuning resolve the earlier exploratory plan.
Reuse the minute scheduler without a new queue/dependency. Consume committed
native/imported messages independently of ingestion behavior.

Deferred: localization, full history pagination, category-specific time series and
correction-rate metrics, spend budgets, Gmail label writes, and automatic question
optimization. Deployment/live-provider verification remain outstanding. This task
applied local migrations only, set no remote key, and enabled no user's account.

Setup and tuning: [operator guide](../implementation/mail-categorization.md).
Sources: [API](https://docs.typesafe.ai/api),
[confidence](https://docs.typesafe.ai/confidence),
[models](https://docs.typesafe.ai/models),
[privacy](https://typesafe.ai/legal/privacy-policy),
[retention options](https://docs.typesafe.ai/legal).

## 13. Bug / Change Log

### 2026-10-02 — Build categorization and tuning

Type: Feature

Summary: Added local rules and optional Jev classification, editable/versioned
questions, sample comparison, historical/source insights, resumable jobs, and
personal corrections. Added original Date storage and privacy disclosure.

Reason: Large imported inboxes need organization and an inspect-and-tune loop.

Impact: New authenticated UI/APIs and append-only migrations. Legacy filters keep
their behavior. Gmail imports are organized locally.

Tests: Spec and failing behavior tests preceded implementation. Safety tests
reproduced overlapping-job, organization-change, mid-batch disclosure, and sender
display-name grouping defects before fixes. Final repository and browser evidence
is above. Deployment/live Jev are not verified.
