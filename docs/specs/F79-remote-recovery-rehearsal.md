# F79 — Remote Recovery Rehearsal

> Status: In Progress — Layers 1.1–1.6 complete; Layer 1.7 cleanup and gate closure next
> Owner area: `scripts/recovery-target-guard.mjs`, `scripts/r2-backup.mjs`,
> `scripts/recovery-capture.mjs`, `scripts/recovery-restore.mjs`, `docs/OPERATIONS.md`

## 1. Problem & User Job

Lumimail can export D1, copy every D1-referenced R2 object with an exact-byte checksum, verify the
backup offline, and restore both stores locally. Those deterministic contracts are proven by F78.
The remaining MVP recovery gate requires exercising the same recovery shape against disposable
remote Cloudflare resources.

A remote restore is destructive by definition. Before any command can write, an operator needs a
fail-closed target boundary proving that the destination is explicitly resolved, belongs to the
expected Cloudflare account, is not any production resource, is empty, and does not receive email.
Names, naming conventions, environment labels, or operator intent are not sufficient evidence.

## 2. User Stories & Acceptance Criteria

- As an operator, I can validate a fully resolved recovery target before writing so that a typo or
  stale configuration cannot overwrite production.
- Given the production and target identities use different Worker, D1, R2, and Queue resources in
  the same expected account, the target D1 and R2 stores are empty, and no Email Routing rule points
  to the target Worker, the guard returns the normalized target identity.
- Given any required account, Worker, D1, R2, or Queue identity is absent, a placeholder, malformed,
  or duplicated, the guard refuses the target.
- Given a target names the production Worker, D1 database ID, R2 bucket, or any production Queue,
  the guard refuses the target even when every other field is safe.
- Given the target account differs from the explicitly expected production account, the guard
  refuses the target. The MVP rehearsal does not silently expand into cross-account recovery.
- Given the target D1 database contains any user table or the target R2 bucket contains any object,
  the guard refuses the target. A schema-only D1 database is permitted because Wrangler may apply
  migrations when provisioning the disposable target.
- Given an enabled Cloudflare Email Routing rule sends to the target Worker, the guard refuses the
  target before restore.
- Given multiple violations, the guard reports every content-free reason in one failure without
  emitting credentials or mail data.

## 3. Scope Boundaries

**In scope for Layer 1.1:**

- A pure target-guard module operating on Cloudflare inventory that has already been retrieved.
- Strict normalization and validation of account, Worker, D1, R2, Queue, row/object-count, and Email
  Routing destination fields.
- Production-resource overlap, same-account, empty-target, and active-mail-route rejection.
- Unit tests for positive and negative safety contracts.
- A data-only error that callers can render in a CLI without parsing prose.

**In scope for later F79 layers:**

- Retrieving the inventory through supported Wrangler/API commands.
- The versioned recovery manifest, read-only production capture, remote D1/R2 restore, integrity
  verification, Worker rollback, cleanup, and operator evidence.

**In scope for Layer 1.3:**

- A production capture CLI that uses only read operations against the active Worker deployment,
  D1, and R2.
- Refusal before D1 export when the Git worktree is dirty, the source commit is not `HEAD`, traffic
  is split across Worker versions, required bindings do not match production configuration, or the
  final output path already exists.
- Capture into a randomly named sibling partial directory, followed by complete offline verification
  and an atomic rename to the requested final directory.
- Removal of only the command-created partial directory after failure; an existing path is never
  reused, merged, emptied, or overwritten.

**In scope for Layer 1.4:**

- Provision or resolve the explicit same-account staging identities `lumimail-staging` Worker,
  `lumimail-staging` D1, and `lumimail-raw-staging` R2 bucket.
- Read target D1 populated-application-table count and R2 `object_count`, and list Email Routing rules for every
  enabled zone. Feed the resolved inventory through `assertSafeRecoveryTarget` immediately before
  the first restore write.
- Import the already verified `d1.sql`, restore the 15 manifest-declared objects to the exact target
  bucket, and deploy the matching commit with staging bindings and no production custom domain.
- Never create an Email Routing rule, Queue consumer/producer, Cron Trigger, or production binding
  as part of restore.
- If any staging resource already contains data, stop for operator review rather than deleting it.

**In scope for Layer 1.5:**

- Select one restored mailbox with a readable message/attachment plus an unrelated restored mailbox
  using content-free staging inventory. Do not print message bodies, addresses, subjects, filenames,
  object keys, or production credential material.
- Create one fixed-ID, recovery-only user with a random one-time password, ordinary organization
  `member` role, and `viewer` access to exactly the selected mailbox. The identity must not own a
  domain/mailbox, receive mail, send mail, or exist in production.
- Authenticate only at the recovery workers.dev origin. Prove session bootstrap, the exact allowed
  mailbox list, an allowed message/body read, attachment metadata and exact attachment bytes, and a
  representative thread/HTML rendering path when present.
- Prove the unrelated mailbox is absent from `/api/mailboxes`, filtered message listing returns no
  rows, and direct unrelated message and attachment reads return `404`.
- If the snapshot has no attachment in the unrelated mailbox, insert one fixed-ID staging-only
  attachment row on the unrelated message by copying metadata/R2 identity from the allowed restored
  attachment. This writes no object and changes no message; cleanup deletes only that fixed row.
- Delete verifier sessions first, then its mailbox membership, organization membership, and user.
  Verify all fixed IDs are absent after cleanup. Cleanup must never select rows by email/domain or
  delete restored production-shaped data.

**In scope for Layer 1.6:**

- Read the isolated recovery Worker's live deployment and deployable version inventory through
  `wrangler.recovery.jsonc`. Require exactly one active version at 100% traffic and two distinct,
  explicit Cloudflare version UUIDs.
- Activate the chosen previous recovery version at 100% with an explicit deployment message, then
  re-read deployment status and require the exact version before smoke.
- Run the six public smoke checks against the workers.dev recovery origin. Do not run mail delivery,
  queues, cron, sending, routing, schema migration, or data writes during the code-only rollback.
- In a mandatory `finally` path, reactivate the originally intended version at 100%, re-read status,
  and run smoke again. A failed rollback smoke must not leave the previous version active.
- Record deployment/version IDs and pass/fail timestamps without credentials, mail data, or bindings
  beyond the already public recovery resource identities.

**In scope for Layer 1.7:**

- Accept the private recovery directory only as an explicit argument, verify its canonical manifest
  and every recorded byte offline again, and never delete or modify that local evidence.
- Require the exact checked-in `wrangler.recovery.jsonc`, recovery Worker name, D1 UUID/name, R2
  bucket, HTTPS workers.dev origin, intended Worker version at 100%, and 6/6 public smoke before any
  deletion. Re-run the forbidden route/binding and production-overlap checks.
- Require the recovery R2 bucket's observed object count to equal the manifest and delete only the
  manifest's exact object keys. Stop if the bucket cannot then be deleted; do not continue to D1.
- Delete in exposure-first order: recovery Worker, exact R2 objects, empty R2 bucket, then recovery
  D1. Do not use Worker force-delete, wildcard object deletion, name inference, or production config.
- Verify the Worker, bucket, and D1 are absent afterward, and compare a content-free production
  resource/routing fingerprint captured immediately before and after cleanup.
- Preserve the private backup until the operator chooses an at-rest encryption, retention, and
  destruction policy. Cleanup of remote rehearsal resources does not imply local archive deletion.

**Out of scope for Layer 1.1:**

- Calling Cloudflare or running Wrangler.
- Creating, deleting, restoring, deploying, routing, or otherwise mutating any resource.
- A web route or product UI.
- Cross-account backup, scheduled backup, retention pricing, or Bucket Lock policy.
- Treating a Worker name, D1 name, bucket naming pattern, or `staging` label as proof by itself.

## 4. Data Model

No application schema or migration change.

The guard consumes an ephemeral content-free inventory:

| Field | Contract | Reason |
|-------|----------|--------|
| `accountId` | 32 lowercase/uppercase hexadecimal characters | Exact account boundary |
| `workerName` | Explicit non-placeholder Worker service name | Production overlap and routing checks |
| `d1.id` | Cloudflare UUID | D1 names are not accepted as identity |
| `d1.name` | Display/diagnostic name | Human-readable evidence only |
| `d1.userTableCount` | Non-negative integer | Target must contain no populated application tables; schema-only retries are allowed |
| `r2.bucketName` | Explicit non-placeholder bucket name | R2 bucket identity within account |
| `r2.objectCount` | Non-negative integer | Target must be empty |
| `queueNames` | Explicit unique Queue names | Production overlap check |
| `emailRoutes` | Enabled flag and destination Worker | Target must not receive email |

No secret, token, cookie, email address, subject, body, attachment name, or R2 object key belongs in
this inventory or in guard errors.

## 5. CLI / Module Contract

Layer 1.1 adds no user-facing CLI command. The module contract is:

```js
assertSafeRecoveryTarget({ production, target })
```

- Returns a normalized, deeply frozen target identity when safe.
- Throws `RecoveryTargetError` with code `UNSAFE_RECOVERY_TARGET` and a frozen `problems` array when
  unsafe.
- Problems are deterministic and ordered by field/safety check so CI and operator output remain
  stable.
- The guard never mutates the supplied inventory.

Later inventory/restore commands must call this function immediately before their first write and
must not catch-and-ignore its error.

### 5.1 `lumimail-recovery-v1` manifest — Layer 1.2

Layer 1.2 adds `scripts/recovery-manifest.mjs` with these pure/offline contracts:

```js
parseRecoveryManifest(jsonOrValue)
canonicalizeRecoveryManifest(jsonOrValue)
verifyRecoveryDirectory(backupDirectory)
```

- `parseRecoveryManifest` accepts JSON text or an already-parsed value, validates the complete
  strict shape, sorts R2 objects by key, normalizes hexadecimal identities to lowercase, rejects
  duplicate keys, and returns a deeply frozen manifest.
- `canonicalizeRecoveryManifest` returns UTF-8 JSON with recursively lexicographic object keys,
  normalized object ordering, no insignificant whitespace, and exactly one trailing newline.
- `verifyRecoveryDirectory` validates `manifest.json`, then checks the exact size and SHA-256 of
  `d1.sql` and every declared R2 object without provider or network access.
- Validation failures throw `RecoveryManifestError` with code `INVALID_RECOVERY_MANIFEST` and a
  frozen, deterministic, content-free `problems` array. Directory integrity failures are returned
  as content-free path/reason strings so an operator can inspect every problem in one pass.
- The previous unversioned R2-only `manifest.json` is not accepted as recovery-grade evidence. The
  existing R2 helper remains unchanged until Layer 1.3 can supply all required source metadata.

The exact v1 shape is:

```json
{
  "format": "lumimail-recovery-v1",
  "product": "lumimail",
  "createdAt": "2026-08-12T13:00:00.000Z",
  "source": {
    "accountId": "32 lowercase hexadecimal characters",
    "worker": {
      "name": "resolved Worker name",
      "versionId": "Cloudflare Worker version UUID",
      "scriptEtag": "provider hashed-script identity",
      "compatibilityDate": "YYYY-MM-DD"
    },
    "d1": {
      "id": "Cloudflare D1 UUID",
      "name": "resolved D1 name",
      "bookmark": "provider bookmark or null"
    },
    "r2": { "bucketName": "resolved R2 bucket name" }
  },
  "application": {
    "gitCommit": "40 or 64 lowercase hexadecimal characters",
    "schemaVersion": "four-digit migration prefix"
  },
  "database": {
    "path": "d1.sql",
    "size": 123,
    "sha256": "64 lowercase hexadecimal characters"
  },
  "objects": [
    {
      "key": "attachments/... or inbound/...",
      "size": 123,
      "etag": "provider ETag or null",
      "sha256": "64 lowercase hexadecimal characters"
    }
  ]
}
```

Unknown fields fail closed. The manifest contains identifiers and hashes but no credentials,
cookies, email addresses, subjects, bodies, attachment names, or object contents.

### 5.2 production read-only capture — Layer 1.3

```text
node scripts/recovery-capture.mjs <new-output-directory>
```

The command derives rather than accepts production resource identity. In order, it:

1. Refuses a dirty worktree and records the exact full `HEAD` commit.
2. Reads `wrangler.jsonc` for the expected account, Worker, D1 binding/UUID/name, R2 bucket, and
   compatibility date; placeholders or ambiguous/missing bindings fail.
3. Queries `wrangler deployments status --json` and requires exactly one version at 100% traffic.
4. Queries that exact version and requires its script ETag, compatibility date, D1 UUID, and R2
   bucket to match configuration.
5. Records a current D1 Time Travel bookmark, exports D1 to `d1.sql`, and hashes the completed file.
6. Extracts only D1-referenced `attachments/` and `inbound/` keys and downloads each exact object.
7. Emits canonical `lumimail-recovery-v1`, verifies the entire directory offline, then atomically
   publishes the new output directory.

Every Wrangler invocation uses explicit `--remote` where the command supports local/remote choice.
The command never invokes D1 execute/import/restore, R2 put/delete, deployment mutation, Queue
mutation, or Email Routing mutation. Standard output contains counts, hashes, resource identities,
and paths only—never SQL, object bytes, object keys, mail metadata, or credentials.

### 5.3 isolated remote restore — Layer 1.4

The restore command requires the private backup directory plus the resolved staging D1 UUID. It
verifies the backup offline, resolves live production and staging inventory, invokes the target
guard, and then performs only these writes in order: apply the manifest-matched staging migrations,
derive and import data-only SQL from the verified full export, exact staging R2 object puts, and
staging Worker deployment. `d1_migrations` rows are not copied because the migration command owns
them. The SQL derivation is quote-aware, so delimiters inside stored message text remain data. A
foreign-key dependency graph derived from the verified schema orders parent-table inserts before
child-table inserts because remote D1 imports do not preserve deferred constraints across provider
batches. Before a retry, every application table is checked for rows; migration-created schema is
allowed, including only the exact migration-owned `imap_uid_counter` baseline `(id=1, value=0)`;
any other populated state fails closed. A command cannot infer `--remote` from an environment
name; every D1 and R2 operation names the
recovery configuration/resource explicitly.
SQLite-owned `sqlite_sequence` rows are excluded from the derived import; AUTOINCREMENT state is
re-established by inserting the captured application rows into the migrated target schema.
The captured `imap_uid_counter` row uses `INSERT OR REPLACE` so its production value replaces the
exact migration baseline and preserves monotonic IMAP UID allocation.

### 5.4 authenticated application verification — Layer 1.5

`scripts/recovery-app-verify.mjs` owns the repeatable verification contract. Its pure SQL renderers
accept already-resolved organization/mailbox IDs and fixed recovery-only row IDs; they never infer a
production target. Provisioning fails if any verifier ID/email already exists or if the allowed and
denied mailboxes are equal. HTTP verification accepts a caller-supplied fetch implementation and
returns only status/count/hash evidence. It treats the one-time password and session cookie as
secrets and never includes either in the report.

The cleanup SQL names only the fixed verifier user/membership IDs and optional fixed denial-fixture
attachment ID. It deletes the fixture and sessions before removing the membership rows and user,
and it is safe to repeat after a partial run. Remote D1 rejects explicit transaction statements in
imported SQL, so the live wrapper runs ordered statements and invokes this cleanup after any
provisioning failure; a fixed-ID absence check is required before retry.

### 5.5 Worker rollback drill — Layer 1.6

`scripts/recovery-rollback.mjs` accepts an explicit recovery config path, workers.dev origin, current
version UUID, previous version UUID, and injected Wrangler/smoke runners. It validates the initial
deployment before mutation, uses `versions deploy <uuid>@100 --yes`, validates provider status after
each deployment, and always attempts to restore the current version. The report contains version
IDs, smoke counts, and final status only. Production config/name/version inference is not supported.

### 5.6 Disposable-resource cleanup — Layer 1.7

The cleanup runner consumes the already verified recovery directory and exact recovery config. Its
preflight is wholly read-only and must complete before the first deletion. The injected command
contract makes deletion order, exact identities, partial-failure stops, absence checks, and
production fingerprint equality executable unit-test behavior. The final report contains resource
names/IDs, deleted-object count, and before/after fingerprint equality only; it contains no mail
content, object keys, SQL, cookies, passwords, or manifest contents.

## 6. UI/UX

No product UI in Layer 1. The operator surface is a future CLI and a content-free evidence report.
Recovery mutation remains outside ordinary authenticated web sessions.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/scripts/recovery-target-guard.test.ts` | Safe target, missing/malformed/placeholders, production overlap, wrong account, non-empty D1/R2, active Email Routing, duplicate Queues, aggregate stable errors, immutability |
| Unit | `tests/unit/scripts/recovery-manifest.test.ts` | Strict v1 parsing, normalization, canonical bytes, version/product rejection, duplicate/path traversal rejection, D1/R2 missing/size/checksum integrity, immutable errors |
| Unit | `tests/unit/scripts/recovery-capture.test.ts` | Read-only command sequence, atomic publication, dirty/existing/split-traffic/binding-drift refusal, partial cleanup |
| Unit | `tests/unit/scripts/recovery-restore.test.ts` | Offline verification, empty/schema-only target checks, malformed inventory, routing refusal, quote-aware extraction, foreign-key ordering, exact D1/R2 writes |
| Unit | `tests/unit/wrangler-recovery-bindings.test.ts` | Recovery Worker has exact isolated D1/R2 bindings and no route, Queue, Cron, Email Sending, or service bindings |
| Unit | `tests/unit/scripts/recovery-app-verify.test.ts` | Fixed-ID provision/cleanup SQL, secret-free report, allowed mailbox/message/attachment reads, and direct/list denial for an unrelated mailbox |
| Unit | `tests/unit/scripts/recovery-rollback.test.ts` | Initial/split/unknown-version refusal, exact rollback command/status/smoke, mandatory return on failure, and final intended-version proof |
| Unit | `tests/unit/scripts/recovery-cleanup.test.ts` | Exact manifest/config/target preflight, ordered deletion, partial-failure stops, absence verification, production-fingerprint equality, and private-evidence preservation |
| Existing regression | `tests/unit/scripts/r2-backup.test.ts` | Exact referenced-key extraction and missing/corrupt object detection |
| Full | repository commands | `npm run verify`; no E2E because Layer 1.1 has no site behavior |

Coverage target: all statements and branches in the new guard module.

## 8. Current Behavior

- `scripts/r2-backup.mjs backup` always reads the configured production bucket and captures only the
  objects referenced by a supplied D1 export.
- `scripts/r2-backup.mjs restore` defaults to local R2, but `--remote` writes to the hard-coded
  production bucket. It has checksum protection but no remote-target identity boundary.
- `scripts/restore-local.mjs` restores only local Miniflare D1 and verifies foreign keys/schema.
- `wrangler.jsonc` declares production and staging resources, but the staging D1 ID is still a
  placeholder. Configuration labels do not prove the remote resources are empty or unrouted.
- No existing command may perform the F79 remote rehearsal safely until a target is resolved and
  accepted by this guard.
- `scripts/recovery-target-guard.mjs` now implements the pure guard. It makes no provider call and
  performs no write; later inventory and restore commands remain required.

## 9. Error States

| Condition | Result | Mutation | Logged data |
|-----------|--------|----------|-------------|
| Required identity absent/malformed/placeholder | `RecoveryTargetError` | None | Field/reason only |
| Target account differs | `RecoveryTargetError` | None | Account mismatch, no credential |
| Production resource overlap | `RecoveryTargetError` | None | Resource type/name or D1 ID |
| D1 contains user tables | `RecoveryTargetError` | None | Count only |
| R2 contains objects | `RecoveryTargetError` | None | Count only |
| Enabled Email Routing points to target Worker | `RecoveryTargetError` | None | Worker name only |
| Inventory lookup later fails | Caller fails closed before invoking restore | None | Provider error code only |

## 10. Edge Cases

- The same-account decision means equality is required, not merely allowed.
- Production and target resource names are compared case-sensitively except account IDs and D1 UUIDs,
  which are canonicalized to lowercase.
- A D1 database with Wrangler/Drizzle migration tables but no application user tables is considered
  empty enough for import; the inventory resolver owns classification of user tables.
- An empty Queue list is allowed for Layer 1.1 because Queue creation is not required to restore D1/R2
  data, but every supplied Queue name must be explicit, unique, and non-production.
- Disabled Email Routing rules do not make the target receive mail and therefore do not block.
- A route pointing to another Worker does not block this target.
- Counts must be observed non-negative integers; `unknown`, negative, fractional, and string counts
  fail closed.
- Error aggregation must not preserve caller-owned mutable arrays or objects.

## 11. Permissions & Security

- The guard is an operator boundary, not an organization role check.
- Cloudflare credentials are used only by later inventory commands and are never accepted by this
  function.
- Production and target inventory must be fetched with the narrowest practical permissions; restore
  credentials are not needed while only validating the target.
- The guard runs again immediately before mutation to reduce stale-inventory risk.
- Destructive commands require separate exact confirmation after this guard passes.
- No recovery artifact or inventory containing private mail data may be committed.

## 12. Open Questions / Decisions

- Decision: the MVP rehearsal uses disposable resources in the same Cloudflare account. — 2026-08-12
- Decision: D1 UUID is required; a D1 name alone is not identity. — 2026-08-12
- Decision: R2 has no separate bucket UUID in the current binding/config model, so account plus exact
  bucket name is its identity. — 2026-08-12
- Decision: target D1 emptiness is based on populated application-table count, allowing
  provisioning/migration schema and metadata while rejecting any table containing rows.
  — 2026-08-12
- Decision: Layer 1.1 validates retrieved inventory but performs no network or Wrangler work.
  Inventory resolution is the next work packet. — 2026-08-12
- Decision: v1 requires the source commit, active Worker version UUID, and Cloudflare script ETag.
  Cloudflare describes the ETag as hashed script content but does not promise SHA-256, so it remains
  an opaque provider artifact identity rather than being mislabeled as a local digest. — 2026-08-12
- Decision: the D1 bookmark is explicitly nullable because portable recovery depends on the export,
  while Time Travel is only a short-window aid. — 2026-08-12
- Decision: legacy unversioned R2 manifests remain usable only by the legacy helper and are not
  accepted as complete recovery evidence. — 2026-08-12
- Decision: L1.3 requires one Worker version at 100% traffic. A gradual deployment needs one backup
  per active artifact or an explicit later manifest extension; silently choosing the largest share
  is unsafe. — 2026-08-12
- Decision: the deployed version UUID and script ETag come from `deployments status` plus `versions
  view`; the latest uploaded version is not assumed active. — 2026-08-12
- Decision: a clean `HEAD` is mandatory because the manifest must name recoverable source. The
  deployment at 2026-08-12 13:29 UTC was built from commit `d53b475`. — 2026-08-12
- Open: choose the long-term backup destination and retention policy after the same-account rehearsal.

## 13. Bug / Change Log

### 2026-08-12 — Add the remote recovery target safety boundary

Type: Security Fix / Feature

Summary:

- Define exact production and recovery target identities.
- Reject ambiguous, production-overlapping, populated, routed, or wrong-account targets before any
  remote recovery write exists.
- Return structured, content-free problems suitable for future operator tooling.

Reason:

- The existing checksum and local-restore protections establish data integrity, but they cannot
  prevent a correctly formed remote restore from targeting the wrong Cloudflare resources.

Impact:

- No resource mutation or user-visible behavior changes in Layer 1.1.
- Future remote recovery commands gain a mandatory fail-closed precondition.

Tests:

- Focused: 10 target-guard tests pass, including malformed production inventory and malformed
  Queue/Email Routing observations.
- Repository: `npm run verify` passes with 1,774 application tests across 195 files at 100%
  configured coverage, plus all 21 IMAP/SMTP bridge tests.

### 2026-08-12 verification evidence

- The new focused suite was observed failing first because the guard module did not exist.
- After implementation, all 10 focused contracts pass.
- `npm run verify` passes. ESLint reports 36 pre-existing warnings and zero errors.
- No E2E run is required because Layer 1.1 adds no site behavior or provider interaction.

### 2026-08-12 — Define the versioned recovery manifest

Type: Feature / Recovery integrity

Summary:

- Add a strict `lumimail-recovery-v1` parser and deterministic canonical serializer.
- Bind recovery evidence to the source account, active Worker version and script ETag, D1
  identity/bookmark, R2 bucket, application commit, schema migration, database export, and exact
  objects.
- Verify the database export and every declared R2 object offline by size and SHA-256.

Reason:

- The previous R2-only manifest proves object bytes but cannot prove which database, deployment,
  schema, or Cloudflare resources a backup represents.

Impact:

- No Worker, site, provider, database, bucket, or legacy backup command changes in Layer 1.2.
- L1.3 can now emit one portable recovery artifact with a stable format.

Tests:

- The manifest suite was observed failing first because `scripts/recovery-manifest.mjs` did not
  exist.
- All 10 focused v1 manifest/parser/canonicalization/offline-integrity contracts pass.
- The legacy R2-only producer was deliberately not switched to v1: it cannot truthfully supply the
  active Worker version/script ETag, source commit, D1 bookmark, or complete resource identity until
  L1.3.
- `npm run verify` passes with 1,784 application tests across 196 files at 100% configured coverage,
  plus all 21 IMAP/SMTP bridge tests. ESLint reports 36 pre-existing warnings and zero errors.

### 2026-08-12 — Deploy the recovery-foundation checkpoint

Type: Deployment evidence

- Commit `d53b475` was pushed to `origin/codex/recovery-foundation` and deployed to production.
- D1 reported no pending migrations.
- Worker version `74b98ae8-484f-4262-9a02-0f224bc8e5cd` (version 69) receives 100% of traffic and
  reports script ETag `6affc3eedacf8467cb333ce1d4d6ea011253b54157efa3cc9ad147d22a2cf330`.
- All six public smoke checks pass: landing/login/manifest return `200`; anonymous session/mailbox/
  admin-mailbox APIs return `401`.
- Read-only inventory confirms the deployed D1 UUID, R2 bucket, queue names, account, Worker name,
  and compatibility date match the production configuration.

### 2026-08-12 — Implement production read-only capture

Type: Feature / Recovery capture

- Add `scripts/recovery-capture.mjs` with clean-commit, unused-output, single-active-version,
  compatibility-date, D1-binding, and R2-binding preconditions before mail data is read.
- Capture D1 plus only its referenced R2 objects into a randomized partial sibling, emit canonical
  v1, verify every byte offline, and publish with an atomic rename.
- Remove only the command-created partial directory on failure and render content-free errors.
- Five focused capture contracts pass after first failing because the module did not exist.
- `npm run verify` passes with 1,789 application tests across 197 files at 100% configured coverage,
  plus all 21 bridge tests. Production capture remains to be run from the clean committed checkpoint.
- First live attempt failed safely before D1 export because `WRANGLER_LOG=none` suppresses Wrangler's
  JSON command result as well as logging. No final directory or partial data remained; the wrapper
  now preserves Wrangler's normal JSON standard output.
- Commit `f4c48db` was deployed, smoke passed 6/6, and the second live capture completed at
  `2026-08-12T13:44:35.174Z` against active Worker version
  `721ad103-ec5a-4b0d-a48c-f664d6814451` and script ETag
  `5bd0e61aed0aa76c3173ab81b708572df8a6362879965d37887e4f77209947c6`.
- The private local capture contains a 99,637-byte D1 export at schema `0028`, a Time Travel
  bookmark, and 15 referenced R2 objects. A second offline pass reports one database, 15 objects,
  and zero integrity problems. The 17 files total 8,519,183 bytes; canonical manifest SHA-256 is
  `e56311ef96d9063b3c5fe04a2610df674d990ac00eedd7dc96a2058b41f482ee`.
- Windows ACL inheritance was removed from the exact backup directory. Only the user, SYSTEM, and
  local Administrators retain access; integrity still passes afterward.
- Separate archive encryption remains an operator decision. BitLocker status could not be inspected
  without administrator access, so this evidence does not claim volume encryption.
- First remote D1 import attempt failed atomically before R2 writes with `no such table: main.users`.
  Content-free inspection proved the full D1 export creates foreign-key tables before referenced
  tables under alphabetical export ordering. Target inventory afterward remained zero tables/zero
  objects. The restore contract now applies schema migrations first and imports derived data only.
- The second data-only import failed atomically before R2 writes with a foreign-key constraint.
  Production `PRAGMA foreign_key_check` returned zero violations, and the target retained only the
  applied schema with no application rows or R2 objects. The derived import now orders tables from
  referenced parents to children and the retry guard accepts schema-only targets only after checking
  every application table for rows.
- The next retry stopped locally before provider access because the full export includes
  SQLite-owned `sqlite_sequence` inserts without a corresponding exported `CREATE TABLE`. The
  derived import now excludes that internal table explicitly.
- The subsequent live guard identified one row in `imap_uid_counter`. Migration `0011` owns the
  exact `(id=1, value=0)` baseline on an otherwise empty target. The guard now permits only that
  exact row and the import replaces it with the captured counter value.
- The first isolated Worker deployment resolved the account-specific hostname as
  `lumimail-recovery-20260812.blackstag.workers.dev`, revealing that the configured
  `PUBLIC_APP_URL` lacked the workers.dev account subdomain. The recovery config now fixes and tests
  the exact deployed origin before application smoke checks.
- The guarded isolated restore completed with one D1 import and 15 exact R2 object writes. A
  content-free comparison proves all 29 application-table row counts equal production, both targets
  have 29 migrations at the same latest migration ID, and staging has zero foreign-key violations.
  All 15 restored objects were downloaded to a dedicated temporary directory and matched the
  manifest byte lengths and SHA-256 values with zero problems; the temporary files were removed.
- Recovery Worker version `34571aef-6642-4ea5-bc42-85eebb730e16` is deployed only at
  `lumimail-recovery-20260812.blackstag.workers.dev` with the staging D1/R2 plus assets/images and no
  Email Routing, custom route, Queue, Cron, Email Sending, or service binding. Public smoke passes
  6/6, and direct browser inspection confirms the labeled login UI renders. No production binding
  or route was changed.
- The first verifier provision attempt was rejected before execution because remote D1 does not
  accept `BEGIN` in imported SQL. All four fixed-ID row counts remained zero. Provision/cleanup SQL
  now omits transaction control and relies on mandatory exact-ID cleanup after partial failure.
- The first API verification login succeeded, but the verifier incorrectly expected a generic
  `session` cookie instead of Lumimail's `ep_session`. The contract now requires the exact
  application cookie name; the disposable session is covered by fixed-user cleanup.
- Authenticated API verification then passed: the verifier session authenticated, `/api/mailboxes`
  returned exactly one allowed mailbox, the allowed message/body loaded, and its 90-byte attachment
  matched manifest SHA-256 `6cafeee8a9f9321f72732db37ab184faaada73530d53bcc3bd40f63ccbc87e5a`.
  The unrelated mailbox list returned zero messages, and direct unrelated message/attachment reads
  both returned `404`.
- Browser verification showed the single permitted mailbox with 13 messages, omitted Compose and
  Drafts for the `viewer`, rendered the attachment message with three attachment controls, and
  rendered restored rich HTML text/link content without console errors. The server session endpoint
  identified only `usr_recoveryverify` throughout.
- Exact cleanup removed the staging-only attachment fixture, all verifier sessions, mailbox/org
  memberships, and user. All five fixed-ID counts are zero, `PRAGMA foreign_key_check` remains
  empty, and the former browser session redirects to `/login` after reload.

### 2026-08-12 — Exercise isolated Worker rollback and return

Type: Operational evidence

- Add a fail-closed rollback runner that accepts two explicit deployable version UUIDs, requires
  one active recovery version at 100% traffic, and refuses production config, HTTP origins, split
  traffic, duplicate IDs, and missing versions.
- Recovery Worker version `7e9f2f79-a2f9-43d8-bbf8-430c0a7bcee1` was activated at 100% and passed
  all six public smoke checks against the restored staging data.
- The mandatory return path restored intended version
  `34571aef-6642-4ea5-bc42-85eebb730e16`, which also passed all six smoke checks.
- An independent deployment read afterward reported only intended version
  `34571aef-6642-4ea5-bc42-85eebb730e16` at 100% traffic, followed by an independent 6/6 smoke run.
- `npm run verify` passes after the rollback implementation; ESLint retains the existing warnings
  and reports zero errors.

### 2026-08-12 — Add guarded cleanup and remove public recovery access

Type: Feature / Partial operational evidence

- Add an exact-target cleanup runner whose preflight re-verifies the private recovery directory,
  intended Worker version, smoke result, R2 object count, D1 identity, routing isolation, and a
  content-free production fingerprint before the first deletion.
- Six focused tests prove exact exposure-first deletion order, wrong-target and failed-smoke
  refusal, stop-before-D1 behavior when the bucket cannot be emptied, final absence checks, and
  production-fingerprint drift detection. `npm run verify` passes with zero lint errors.
- Read-only inventory showed the staging D1 and R2 were created for this rehearsal on 2026-08-12
  and no standing `lumimail-staging` Worker exists. The resource names nevertheless remain declared
  in the repository's future staging environment, so the cleanup evidence names exact UUIDs rather
  than relying on the `staging` label.
- The private capture directory could not be located on any mounted drive. The cleanup runner
  therefore refused to delete D1/R2 rather than reducing the number of recoverable copies without
  first re-verifying the local archive.
- The independently isolated `lumimail-recovery-20260812` Worker was deleted to remove public
  access. Provider status now returns Worker-not-found, while production smoke remains 6/6.
- The exact recovery D1 remains present and the exact recovery R2 bucket still contains 15 objects.
  Their removal and production before/after fingerprint comparison remain pending the private
  backup path. No local backup deletion was attempted.
