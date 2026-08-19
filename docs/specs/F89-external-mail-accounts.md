# F89 — External Mail Accounts and Unified Mailbox

> Status: Implemented; controlled provider/deployment evidence pending
> Owner area: `src/app/(settings)/settings/external-accounts/`,
> `src/app/api/external-accounts/`, `src/lib/email/external/`, `worker.ts`

## 1. Problem & User Job

Lumimail can receive mail for domains routed through Cloudflare, send through its
configured outbound provider, and expose Lumimail mail to standard clients through
the separate IMAP/SMTP bridge. It cannot connect in the opposite direction: a user
cannot attach an existing Gmail, Microsoft 365, Outlook.com, or generic IMAP account
and work with copies of that account's mail inside Lumimail.

As a mailbox user, I want to connect an existing external account so that I can read
and send its mail from Lumimail alongside my Lumimail-hosted mail. When I explicitly
select retention, I also want Lumimail to preserve an exact original copy independently
of ordinary remote mailbox cleanup.

This feature is delivered in stages. The first stage is an OAuth-first, one-way
aggregation MVP for Google and Microsoft. Later stages add generic IMAP/SMTP, broader
historical coverage, provider push, and finally deliberate two-way synchronization.

## 2. User Stories & Acceptance Criteria

### 2.1 OAuth aggregation MVP

- As a send-capable mailbox member, I can connect one Google or Microsoft account to
  one Lumimail mailbox that I manage.
  - Given recent Lumimail authentication and a provider authorization-code flow with
    PKCE, when provider consent succeeds, then the callback is bound to the initiating
    user, organization, mailbox, provider, and one-time state value.
  - The connected external address must match the provider identity returned by the
    provider. The browser may not assert or replace it.
  - The consent screen must name the target Lumimail mailbox and disclose that every
    Lumimail user with read access to that mailbox can read imported mail.
- As a connected user, I can import new mail and an explicitly selected bounded recent
  window.
  - MVP choices are `from_now` and `recent_30_days`; the default is `from_now`.
  - The initial import is asynchronous, resumable, paginated, and visible as a status;
    the OAuth callback never waits for mailbox history to download.
  - Incremental sync uses Gmail history cursors or Microsoft Graph folder delta links.
  - If a cursor expires or becomes invalid, the account enters `resync_required`; it
    does not silently present stale data as current.
- As a mailbox reader, I can distinguish externally sourced mail from native Lumimail
  mail and see its provider/account source.
  - Inbox, Sent, and ordinary archived mail are imported in the MVP.
  - Provider drafts, Spam/Junk, Trash/Deleted Items, arbitrary custom folders, and the
    complete Gmail multi-label model remain later scope.
- As a send-capable mailbox member, I can send through the external account.
  - Google uses Gmail `messages.send`; Microsoft uses Graph `sendMail`.
  - Lumimail's existing durable outbound job remains authoritative for accepted,
    processing, sent, and failed state.
  - The sender is fixed to the connected provider identity or to a provider-verified
    send-as identity returned by the provider; arbitrary From addresses are rejected.
  - A provider-created Sent copy is reconciled with the Lumimail outbound row rather
    than displayed as a duplicate.
- As the connection owner, I can pause, resume, reconnect, and disconnect my external
  account.
  - Pausing stops new import and external sending without deleting imported copies.
  - Revocation/disconnection invalidates local use immediately and attempts provider
    token revocation where supported. It never deletes remote mail.
- As a connection owner, I can opt into exact-original retention for newly imported
  messages.
  - When enabled, the normalized message and attachments follow the existing storage
    path and an exact provider MIME representation is retained in R2 with a checksum.
  - Remote deletion never deletes a retained original in the aggregation MVP.
  - The UI calls this `Retain original copies`, not `Backup`, because the MVP does not
    yet guarantee complete history, restore, or legal/compliance retention.

### 2.2 Expansion acceptance criteria

- Generic accounts can connect through secure IMAP plus authenticated SMTP using a
  separately deployed connector service and OAuth or app-specific credentials.
- Full-history import is resumable and gives a count/date completeness report.
- Provider push notifications can wake incremental sync, with scheduled polling kept
  as reconciliation rather than removed.
- Two-way mode is a separate explicit opt-in. Before it ships, read/unread, folder,
  label, archive, and delete conflicts have deterministic rules, tombstones, loop
  prevention, audit history, and recovery tests.
- A feature described as `Backup` has a verified export and restore path, integrity
  checks, retention/deletion controls, and a production rehearsal. Retaining objects
  alone is not sufficient.

## 3. Scope Boundaries

### 3.1 OAuth aggregation MVP — in scope

- Delegated OAuth connections for Google Gmail/Workspace and Microsoft
  Outlook.com/Microsoft 365.
- Authorization Code with PKCE, exact redirect URIs, one-time state, delegated refresh
  tokens, least-privilege read/send scopes, and explicit consent.
- One external account mapped to one existing Lumimail mailbox.
- `from_now` or bounded 30-day initial import.
- Queue-driven initial and incremental import for Inbox, Sent, and ordinary archive.
- Provider-specific incremental cursors and idempotent remote-message mapping.
- Per-connection outbound routing through Gmail API or Microsoft Graph.
- Optional exact-original retention for messages imported after the option is enabled.
- Connection status, last successful sync, bounded error category, pause, reconnect,
  and disconnect controls.
- Organization/mailbox authorization, security events, operational health, and
  content-free logs.

### 3.2 OAuth aggregation MVP — out of scope

- Generic IMAP or SMTP credentials.
- Full-history completeness, provider drafts, Spam/Junk, Trash/Deleted Items, custom
  folder parity, and lossless Gmail multi-label editing.
- Propagating local read, starred, archive, move, label, or delete changes remotely.
- Provider push/webhook dependence; scheduled reconciliation is sufficient for MVP.
- Tenant-wide Google domain delegation or Microsoft application permissions. MVP
  connections are delegated and individually consented.
- Importing contacts or calendars.
- Claiming disaster-recovery, compliance archive, legal hold, or immutable/WORM
  guarantees.

### 3.3 Expansion stages

| Stage | Outcome | Principal additions |
|---|---|---|
| 1 — OAuth aggregation MVP | Google/Microsoft mail in Lumimail with provider send | Delegated OAuth, bounded import, delta/history sync, retained originals option |
| 2 — Generic mail gateway | Other providers can participate | Companion connector, IMAP UID/UIDVALIDITY sync, OAuth/XOAUTH2 or app credentials, SMTP submission |
| 3 — Complete mirror/archive | Broader faithful local copy | Full history, all folders, Gmail labels, push wakeups, completeness report, export/restore rehearsal |
| 4 — Two-way synchronization | Lumimail can control remote state | Remote mutations, conflict policy, tombstones, loop prevention, recovery and audit |

## 4. Architecture and Data Model

### 4.1 Runtime architecture

```text
Google Gmail API / Microsoft Graph
                 |
                 | HTTPS + delegated OAuth
                 v
        Worker routes and Cron trigger
                 |
                 v
          EXTERNAL_SYNC_QUEUE  ---> external-sync DLQ
                 |
                 +----> D1 connection, cursor, mapping, message metadata
                 |
                 +----> R2 attachments and optional retained original MIME

Later generic providers
                 |
                 | IMAPS / SMTP submission
                 v
     separately deployed connector service
                 |
                 +----> mailbox-scoped Lumimail HTTPS sync API / queues
```

The OAuth MVP stays inside the Worker because Google and Microsoft expose HTTPS APIs.
Cron schedules bounded reconciliation, and a dedicated Queue isolates provider
throttling and retries from native inbound and outbound delivery. The existing
client-facing `imap-bridge` remains a separate concern.

Generic IMAP is placed in a companion service in Stage 2. Cloudflare Workers can make
outbound TCP connections, but long-lived IMAP IDLE sessions, provider-specific socket
behavior, and large historical traversals should not share a request-oriented Worker
lifecycle. The service must use only authenticated, mailbox-scoped Lumimail HTTPS
contracts and must not receive direct D1 or R2 credentials.

### 4.2 Proposed tables

Names are provisional until implementation begins. Provider-specific opaque values
must be treated as untrusted bounded strings.

| Table | Important columns | Notes |
|---|---|---|
| `external_accounts` | id, organizationId, mailboxId, ownerUserId, provider, externalAddress, encryptedRefreshToken, tokenKeyVersion, status, importMode, retainOriginal, lastSyncAt, lastErrorCode, createdAt, revokedAt | One delegated identity mapped to one Lumimail mailbox; no access token or plaintext secret is returned by APIs |
| `external_sync_cursors` | accountId, remoteFolderKey, cursorType, encrypted/opaque cursor, updatedAt | Gmail history ID or Microsoft delta link; unique per account/folder |
| `external_messages` | accountId, remoteMessageId, remoteThreadId, remoteFolderKey, lumimailMessageId, remoteRevision, firstSeenAt, lastSeenAt, removedAt | Unique `(accountId, remoteMessageId)` is the primary deduplication boundary |
| `external_sync_jobs` | id, accountId, kind, status, cursorBefore, attempts, nextAttemptAt, errorCode, createdAt, completedAt | Durable source for initial import, incremental sync, resync, and reconciliation |
| `external_originals` | accountId, remoteMessageId, lumimailMessageId, r2Key, sha256, size, retainedAt | Present only when exact-original retention is enabled |

Existing `messages`, `message_bodies`, and `attachments` remain the user-facing mail
store. `messages` needs an external source/account reference or equivalent normalized
join so source filtering and deletion policy never rely on an address or RFC
`Message-ID`. RFC `Message-ID` remains useful for threading and Sent reconciliation,
but is not unique or reliable enough for import idempotency.

Tokens require authenticated encryption such as AES-GCM using a versioned key supplied
as a Worker secret. Hashing is not sufficient because Lumimail must recover refresh
tokens. OAuth client secrets and encryption keys remain deployment secrets; token
ciphertext, nonce, provider, key version, and minimal lifecycle metadata may be stored
in D1. Token key rotation must decrypt with the prior version and rewrite with the
current version without exposing plaintext to logs or responses.

## 5. API Contract

Final names may change to follow the implementation's route grouping, but the bounded
behavior is fixed here.

| Method | Route | Auth | Request / result | Errors |
|---|---|---|---|---|
| GET | `/api/external-accounts` | signed-in user + live mailbox membership | Connections visible to the user; secret-free status only | 401, 403 |
| POST | `/api/external-accounts/oauth/start` | recent session + mailbox `manage` and `send` capability | Provider, mailboxId, importMode, retainOriginal; returns exact provider redirect | 400, 401, 403, 409, 429, 503 |
| GET | `/api/external-accounts/oauth/callback` | one-time state + provider code | Completes exact initiating connection and queues initial sync | provider-safe 400/409/503 page |
| GET | `/api/external-accounts/:id` | connection owner or authorized mailbox manager | Secret-free provider identity, mode, progress, health, timestamps | 401, 403, 404 |
| PATCH | `/api/external-accounts/:id` | connection owner + current mailbox `manage`; recent auth for retention expansion | Pause/resume, import mode where safe, future-import retention toggle | 400, 401, 403, 404, 409 |
| POST | `/api/external-accounts/:id/reconnect` | connection owner + recent session | Begins a new bound OAuth flow | 401, 403, 404, 409, 429 |
| DELETE | `/api/external-accounts/:id` | connection owner + recent session | Revokes local connection; imported mail retained unless separately deleted | 401, 403, 404, 409 |
| POST | `/api/external-accounts/:id/sync` | connection owner or mailbox manager | Idempotently requests bounded sync; does not run it inline | 401, 403, 404, 409, 429 |

Every collection/detail operation is constrained by organization, live mailbox
membership, connection ownership/capability, and opaque ID. Unauthorized objects
return `404` where enumeration would disclose another tenant's account.

The existing compose/send API gains an optional authorized external connection ID.
The server derives provider and From identity from that connection; clients cannot
supply provider credentials or override the connected address.

## 6. Synchronization and Delivery Contract

### 6.1 Import

1. OAuth completion stores the encrypted refresh token and an inactive cursor in one
   committed account state, then creates an idempotent initial-sync job.
2. Queue workers claim one job/account lease so concurrent Cron, manual, and callback
   triggers cannot run overlapping imports for the same connection.
3. Each provider page is bounded. Remote IDs are inserted/upserted through the unique
   external mapping before notification side effects are emitted.
4. A normalized message uses the existing sanitization, threading, attachment, and
   mailbox authorization rules. Provider content is no more trusted than SMTP input.
5. The next cursor commits only after the page's message mappings and Lumimail rows
   commit successfully. A retry may repeat provider reads but must not duplicate mail.
6. Provider removal events mark the external mapping as removed. In the aggregation
   MVP they do not delete the Lumimail message or retained original.
7. Scheduled reconciliation enqueues accounts due for sync. Provider rate limits use
   classified retry with bounded exponential backoff and jitter; authorization failure
   changes the account to `reconnect_required` and stops automatic retry.

### 6.2 Outbound

1. Compose authorization verifies live send access to the Lumimail mailbox and active
   ownership/use permission for the external connection.
2. The immutable outbound snapshot records the external account ID and derived sender
   identity, never a token.
3. The existing durable outbound consumer selects the Google or Microsoft adapter,
   obtains a short-lived access token, and sends through the provider HTTP API.
4. Provider acceptance updates the existing message/job lifecycle. Ambiguous provider
   outcomes remain visible and follow the existing operator-confirmed recovery policy.
5. Later import of the provider Sent item reconciles through provider ID where returned,
   otherwise RFC `Message-ID` plus a bounded sender/recipient/time match. An ambiguous
   match is retained and flagged rather than silently merging unrelated messages.

### 6.3 Architecture deepening contract

This change preserves the Stage 1 user contract while concentrating synchronization,
provider, credential, and verification behavior behind deeper module interfaces.

- Exactly one `pending` or `processing` sync job may exist for an external account.
  D1 enforces this invariant rather than relying on check-then-insert behavior.
- A new request reuses the active job. Stronger intent wins in this order:
  `resync`, `initial`, then `incremental`/`reconcile`. If stronger intent arrives while
  a page is processing, that page finishes before the same active job returns to
  `pending` with the stronger intent.
- Queue payload version 1 remains unchanged and contains only the job ID. Existing
  account, message, cursor, and completed-job data remains valid.
- Sync-job creation, coalescing, claim, wake-up, retry scheduling with jitter,
  completion, failure, and enqueue recovery live behind one durable job interface.
- A Sync Page applies as one D1 progress decision: normalized messages, external
  mappings, retained-original metadata, and the next cursor commit together. Required
  R2 objects are written first and compensated if D1 fails; failed compensation is
  recoverable as an orphan and never permits cursor advancement.
- Google and Microsoft each provide one provider adapter covering delegated OAuth,
  bounded synchronization, and sending. Provider selection happens once per workflow;
  provider-specific folders, cursors, endpoints, and response validation remain inside
  the selected adapter.
- Provider adapters receive short-lived access tokens only. A credential-custody
  module exclusively owns Delegated Credential encryption, account identity binding,
  refresh, and compare-and-set rotation, and returns typed outcomes. The calling sync
  or outbound workflow owns account and job lifecycle transitions.
- Tests use the same durable job and page interfaces as callers. Database invariants,
  transactions, conflicts, lease expiry, and coalescing are verified with real
  SQLite/D1 semantics; implementation-order mocks replaced by those tests are removed.

Edge and error behavior:

- Competing job creation cannot produce two active jobs for one account.
- A weaker request never downgrades pending or in-flight work.
- A crashed or expired worker lease makes the active job claimable without creating a
  second active job.
- Transient provider failures use bounded exponential backoff with jitter; tests assert
  bounds, not one exact delay.
- A provider page replay may repeat reads and R2 writes but cannot duplicate Lumimail
  messages, mappings, or Retained Originals.
- Any message, mapping, metadata, or D1 commit failure leaves the prior cursor visible.
- Delegated Credential revocation becomes a typed credential outcome; no adapter or
  caller receives plaintext refresh credentials.
- This change adds no providers, generic IMAP ingestion, provider push, or two-way
  synchronization.

## 7. UI/UX

- Add `External accounts` to the unified Settings shell for eligible mailbox users.
- Connection flow: choose provider, choose an authorized target mailbox, select
  `from now` or `last 30 days`, optionally select `Retain original copies`, review the
  mailbox-sharing disclosure, reauthenticate, then leave Lumimail for provider consent.
- Connection cards show provider, external address, target mailbox, owner, import mode,
  retention choice, status, progress, last successful sync, and a bounded actionable
  error. They never show scopes as a substitute for plain-language consent.
- Statuses: `connecting`, `initial_sync`, `active`, `paused`, `reconnect_required`,
  `resync_required`, `error`, and `disconnected`.
- Imported message rows and details show a source badge such as `Google · user@example.com`.
- Compose offers the external sender only when the connection is active and the current
  user has send capability. If the connection expires after draft creation, sending
  fails clearly without silently falling back to another provider or identity.
- Retention copy explains: "Keeps exact originals imported after this is enabled.
  This is not yet a complete or independently verified backup."
- Initial import and sync failures are never rendered as an empty mailbox.
- All controls require keyboard access, screen-reader labels, localized copy, and usable
  layouts at 390 px and desktop widths.

## 8. Current Behavior

- A manager can connect delegated Google or Microsoft identities from External
  accounts settings after recent authentication and the mailbox-sharing disclosure.
- OAuth uses PKCE, one-time session-bound state, live callback authorization, provider
  identity lookup, encrypted refresh-token storage, and exact reconnect binding.
- A dedicated queue and minute reconciliation trigger import bounded Google Gmail
  history or Microsoft Inbox/Sent/Archive delta pages into the existing normalized
  D1/R2 mail store. Provider removals preserve local content.
- Compose can select an active accessible external identity. The durable outbound job
  stores only the external account ID and derived sender; its consumer refreshes the
  delegated token and sends through Gmail `messages.send` or Graph `sendMail`.
- Exact original MIME retention is prospective, opt-in, checksummed, and independent
  from provider deletion. It is explicitly not presented as a complete backup.
- The separate F13/F52 bridge exposes Lumimail mail to IMAP/SMTP clients. It does not
  import mail from an external server.
- Generic IMAP/SMTP ingestion, full-history completeness, restore, provider push, and
  two-way remote state mutation remain the staged expansion described above.
- D1 now enforces one active Sync Job per External Account. OAuth completion, manual
  sync, resume, and scheduled reconciliation use one creation/coalescing module;
  stronger intent is retained without creating overlapping work, and retries use
  bounded exponential jitter.
- Google and Microsoft behavior is selected through one provider adapter seam covering
  OAuth, bounded page retrieval, and outbound sending. Stored Delegated Credentials are
  opened, refreshed, and compare-and-set rotated only by credential custody; adapters
  receive short-lived access tokens.
- A Sync Page prepares normalized message, mapping, attachment, Retained Original, and
  cursor statements before committing them in one transactional D1 batch. R2 objects
  written during preparation are compensated if preparation or the D1 commit fails.

## 9. Error States

| Condition | User-visible result | Runtime behavior |
|---|---|---|
| OAuth state missing, expired, replayed, or bound to another session/mailbox | Connection refused; restart connection | No token stored; security event without code/token |
| Provider identity differs from expected callback identity | Connection refused | No browser-supplied identity accepted |
| User loses mailbox access during OAuth | Connection refused | Callback rechecks live authorization |
| Refresh token rejected/revoked | `Reconnect required` | Stop import/send; do not retry credentials indefinitely |
| Provider throttles or is temporarily unavailable | `Sync delayed` | Classified bounded retry; prior mail remains readable |
| Cursor/delta link invalid or expired | `Resync required` | Preserve local data; require bounded resync path |
| Queue enqueue fails after connection commit | `Sync pending` | Durable D1 job remains discoverable by scheduled reconciliation |
| Message page partially fails | No false success or cursor advance | Retry same page idempotently |
| Original MIME write fails when retention is selected | Message not claimed as retained | Retry or expose retention failure; never mark checksum/object complete |
| External send provider returns a permanent denial | Existing outbound job/message becomes failed | No fallback sender/provider |
| Provider accepts send but response is lost | Ambiguous delivery warning | Existing explicit recovery contract applies; possible duplicate disclosed |
| Disconnect token revocation fails | Connection locally unusable, revocation pending | Retry bounded provider revocation; do not restore local access |

## 10. Edge Cases

- Two users try to attach the same provider account to the same Lumimail mailbox.
  Return `409`; do not create competing cursors.
- The same external account may be attached to a different Lumimail organization only
  after an explicit second consent and disclosure. Cross-tenant mappings never share
  tokens, cursors, or remote-message rows.
- One external message can lack or duplicate an RFC `Message-ID`; provider remote ID
  remains authoritative for deduplication.
- Gmail labels are many-to-many while Lumimail folders are primarily one status. MVP
  derives Inbox/Sent/archive presentation without claiming editable label parity.
- A message moves remotely between imported folders. Its external mapping and Lumimail
  row remain stable; a move must not manufacture a second message.
- A provider deletion arrives after exact-original retention. The retained copy stays;
  the source metadata records the remote removal.
- Retention enabled later is prospective in the MVP. The UI must not imply that already
  imported messages were backfilled.
- An account with more messages than one job budget continues from its cursor through
  later queue jobs; it never increases one invocation's limits to finish inline.
- Token refresh races use one account lease and compare-and-set token versioning so an
  older completion cannot overwrite a rotated refresh token.
- Connection ownership loss, user deletion, mailbox deletion, organization switch, and
  mailbox-role downgrade fail closed and stop new provider access.
- Provider HTML, attachment names/types, header values, MIME nesting, and message sizes
  retain the existing inbound safety and omission policies.

## 11. Permissions, Privacy, and Security

- A user may connect only while they hold live mailbox `manage` and `send` capabilities.
  The connection is owned by the consenting Lumimail user. Organization admin status
  alone does not permit an admin to obtain or use another user's provider token.
- Imported content is readable by every user with read access to the target Lumimail
  mailbox. This is disclosed before provider consent and rechecked at callback.
- The MVP requests provider read and send scopes, not remote mailbox mutation scopes.
  Scope expansion for two-way sync requires a new consent and cannot occur silently.
- OAuth uses exact registered redirects, Authorization Code with PKCE S256, one-time
  expiring state, issuer/provider binding, and login-CSRF protection. Callback errors
  never echo authorization codes, tokens, or provider response bodies.
- Refresh tokens are encrypted at rest with versioned authenticated encryption. Access
  tokens are short-lived and not persisted unless a later implementation proves a
  bounded operational need. Secrets never enter queue payloads, outbound snapshots,
  analytics, logs, webhooks, browser storage, or API responses.
- Account, cursor, message, sync-job, and retained-object access is organization- and
  mailbox-scoped. Cross-tenant tests are mandatory on every endpoint and worker path.
- Provider adapters enforce HTTPS and fixed official hosts. A user cannot supply an
  arbitrary token endpoint, API base URL, redirect URL, IMAP host, or SMTP host in the
  OAuth MVP.
- Stage 2 generic hosts require DNS/IP validation against loopback, link-local, private,
  metadata, and Cloudflare/internal destinations on every resolution/connect attempt,
  plus certificate verification, port allowlists, size/time bounds, and DNS-rebinding
  defenses.
- Security events record connection, reconnect, pause, resume, retention expansion,
  disconnect, scope change, and repeated authorization failure without addresses,
  subjects, message content, tokens, codes, cursors, or provider error bodies.
- Provider terms, OAuth verification, privacy policy, data deletion, and organizational
  admin-consent requirements are release gates, not documentation-only tasks.

## 12. Test and Verification Plan

### 12.1 Automated tests

| Layer | Coverage |
|---|---|
| Unit | provider normalization, folder mapping, dedup keys, cursor transitions, retry classification, exact-original checksums, sender binding, Sent reconciliation |
| Crypto | AES-GCM round trip, wrong key/AAD/tampering refusal, version rotation, plaintext exclusion, concurrent refresh compare-and-set |
| Route | start/callback PKCE and state lifecycle, callback authorization recheck, connection CRUD ownership, recent-auth boundaries, non-enumeration, validation and rate limits |
| D1 integration | unique account/remote IDs, account lease, atomic page+cursor commit, idempotent replay, remote move/removal, prospective retention, tenant isolation |
| Queue | initial paging, incremental sync, retry/DLQ, cursor expiry, reconciliation of committed-but-not-enqueued jobs, revoked-account refusal |
| Provider contract | recorded Google and Microsoft success/error/throttle/expired-cursor fixtures without live tokens or message content in the repository |
| Existing mail pipeline | sanitizer, threading, attachment bounds, notifications, search, folder queries, and all-mailbox scope accept external imports without authorization regressions |
| Browser | connect disclosure, mocked provider callback, progress/error/reconnect/pause/disconnect, source badge, compose sender, mobile and accessibility |

All new/changed runtime files require 100% configured statement, branch, function, and
line coverage. Tests may not rely on a developer's external mailbox or persist live
provider credentials.

### 12.2 Provider and production evidence

- Separate disposable Google and Microsoft test tenants/accounts complete real delegated
  OAuth with only the documented scopes.
- Seed a uniquely identifiable message and attachment, perform initial and incremental
  sync, and verify exactly one authorized Lumimail row, exact bytes, source mapping,
  threading metadata, and no access from an unrelated mailbox/user.
- Repeat the same provider change after replaying the queue message and after a simulated
  transport failure; verify no duplicate.
- Send one controlled message through each provider and verify durable state plus one
  reconciled Sent row.
- Revoke consent at the provider, prove import/send stops and `reconnect_required` is
  visible, then reconnect without duplicating prior mail.
- Enable retained originals before a controlled import, verify R2 SHA-256/size and
  download bytes, delete the provider copy, and prove the retained Lumimail copy remains.
- Run `npm run verify`, `npm run e2e`, OpenNext production build, fresh-D1 migration,
  deployment dry run, audits, and public/authenticated smoke appropriate to the change.

## 13. Delivery Plan and Estimates

Estimates are planning ranges for one experienced engineer and include specification,
tests, UI, provider failure handling, and controlled evidence. They are not commitments.

| Slice | Expected work | Estimate |
|---|---|---:|
| Foundation | schema, encrypted token vault, OAuth state/PKCE, account UI/API, sync jobs and health | 2–3 weeks |
| Google MVP | Gmail bounded import/history sync, normalization, provider send, Sent reconciliation | 2–3 weeks |
| Microsoft MVP | Graph bounded import/delta sync, normalization, provider send, Sent reconciliation | 2–3 weeks |
| Retained originals and hardening | MIME retention, integrity metadata, revocation/resync, isolation and production evidence | 2–3 weeks |
| **OAuth aggregation MVP total** | overlapping work combined | **8–12 weeks** |
| Generic IMAP/SMTP | connector host, safe endpoint policy, UID/UIDVALIDITY sync, OAuth/app credentials, deployment | +4–7 weeks |
| Full history/archive | all folders/labels, completeness reports, export/restore and retention rehearsal | +3–6 weeks |
| Two-way sync | remote mutations, conflicts, tombstones, loop prevention, recovery/audit | +6–10 weeks |

### Recommended implementation order

1. Build the shared account, token, job, cursor, message-mapping, and UI foundation.
2. Ship Google against disposable accounts and stabilize the common adapter contract.
3. Add Microsoft without weakening provider-specific semantics into a false universal
   model.
4. Complete retained-original integrity and production evidence before calling Stage 1
   shipped.
5. Design the generic connector as a separate Stage 2 spec based on the proven adapter
   contract.
6. Treat complete archive and two-way sync as separate acceptance gates; neither is an
   automatic consequence of successful importing.

## 14. Decisions and Open Questions

### Decisions

- Decision 2026-08-19: deepen F89 in two verified slices: durable jobs/page application
  first, then provider adapters/credential custody. Complete both without expanding the
  Stage 1 product scope.
- Decision 2026-08-19: enforce one active Sync Job per External Account in D1 and
  coalesce stronger intent onto that job while preserving queue payload version 1.
- Decision 2026-08-19: provider adapters receive only short-lived access tokens;
  credential custody owns stored Delegated Credentials and returns typed outcomes,
  while workflows own lifecycle transitions.

- Decision 2026-08-15: Google and Microsoft use their HTTPS APIs rather than treating
  IMAP/SMTP as the preferred provider path. Their incremental APIs and delegated OAuth
  provide clearer cursor, throttling, folder, and error contracts.
- Decision 2026-08-15: MVP synchronization is one-way into Lumimail. Local message-state
  changes never mutate the remote account, avoiding premature delete/move conflicts.
- Decision 2026-08-15: outbound mail uses the connected provider so recipient-visible
  identity and the provider's Sent store remain coherent.
- Decision 2026-08-15: initial import is bounded to from-now or 30 days. Full-history
  completeness is a later archive stage.
- Decision 2026-08-15: retained original copies are opt-in and prospective. They are not
  marketed as backup until export/restore and completeness are verified.
- Decision 2026-08-15: delegated connection tokens belong to the consenting Lumimail
  user and cannot be appropriated solely through organization administration.
- Decision 2026-08-15: generic IMAP/SMTP uses a companion service; the OAuth HTTP MVP
  stays on Workers, Queues, D1, and R2.
- Decision 2026-08-15: scheduled polling/reconciliation is authoritative in the MVP;
  provider push is a later latency optimization.

### Deferred decisions

- Implemented scope decision: Google requests OpenID/email plus Gmail read-only and
  send; Microsoft requests OpenID/email/offline access, User.Read, Mail.Read, and
  Mail.Send. No message-mutation scope is requested.
- Implemented multiplicity decision: a mailbox may expose multiple active external
  senders, each bound to its consenting owner; compose defaults to the native identity
  and requires explicit external selection.
- Implemented execution decision: provider pages are capped at ten messages, queue
  jobs lease one account, and minute reconciliation recovers committed work and polls
  active accounts without depending on provider push.
- Implemented retention decision: originals use a dedicated
  `external-originals/<organization>/<account>/` prefix and D1 integrity ledger in the
  existing bucket. A separate compliance/archive bucket remains Stage 3 scope.
- Decide the product behavior when the consenting user leaves an organization but the
  organization wants to retain already imported mail. New provider access must stop;
  retained local data ownership and deletion require explicit policy.
- Before Stage 2, select connector hosting, mutual authentication, certificate
  provisioning, and whether the existing `imap-bridge` package is extended or kept as a
  separate deployable process.

## 15. References

- [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)
- [Gmail sending](https://developers.google.com/workspace/gmail/api/guides/sending)
- [Google Workspace third-party client OAuth guidance](https://support.google.com/a/answer/9003945)
- [Microsoft Graph message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [Microsoft Graph sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0)
- [Microsoft IMAP/POP/SMTP OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Cloudflare Workers TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [F33 outbound providers](./F33-outbound-mail-providers.md)
- [F52 IMAP/SMTP bridge contract](./F52-imap-smtp-bridge-contract-repair.md)
- [F63 R2 retention](./F63-r2-retention-and-cleanup.md)

## 16. Bug / Change Log

### 2026-08-19 — Deepen external-account synchronization architecture

Type: Architecture / Correctness Change

Planned summary:

- Consolidate durable Sync Job creation, coalescing, leases, transitions, jitter, and
  enqueue recovery behind one interface with a D1-enforced active-job invariant.
- Commit each Sync Page's D1 state and cursor as one progress decision with explicit R2
  compensation.
- Select one Google or Microsoft adapter per workflow and isolate stored Delegated
  Credentials behind credential custody.
- Replace implementation-order database mocks with interface-level and real SQLite/D1
  durability tests.

Reason:

- The implemented MVP repeats job and credential invariants across callers, exposes
  provider-specific knowledge to orchestration, and cannot currently prove the F89
  account-lease, jitter, or page/cursor atomicity contracts.

Verification plan:

- Add migration tests for the active-job uniqueness and compatible existing data.
- Add state-based tests for competing creation, intent coalescing, lease expiry,
  enqueue failure recovery, jitter bounds, page rollback, R2 compensation, and replay.
- Retain direct provider-adapter and AES-GCM primitive coverage while replacing tests
  that reach past the new interfaces.
- Run `npm run verify`; no E2E run is required unless implementation changes a
  user-visible contract.

Result:

- Added migration `0039`, including safe coalescing of any pre-existing duplicate
  active jobs, preservation of every job row, a carried-forward stronger intent, and a
  partial unique active-account index. Wrangler fresh and staged-upgrade migration
  suites pass.
- Added durable job, provider adapter, credential-custody, and Sync Page modules;
  callers now cross those interfaces instead of reconstructing job, provider, crypto,
  or page/cursor implementation details.
- `npm run verify` passes: 300 application test files / 2,572 tests at 100% statement,
  branch, function, and line coverage, plus 21 IMAP/SMTP bridge tests.
- Browser E2E was not run because the user-visible F89 contract and routes/UI are
  unchanged.
- Production migration `0039` applied successfully on 2026-08-19 and Worker version
  `12eeb49b-3ef5-4195-98a2-83abaa06d2a5` now receives 100% of traffic. The read-only
  production doctor passes 26/26 with no pending migrations, exact active-version
  bindings and handlers, public smoke, schedule, D1, R2, queues, Email Routing, and
  Email Sending all healthy.
- Controlled Google/Microsoft provider evidence remains pending under the existing
  F89 release gate.

### 2026-08-15 — Repair external-sync deployment wiring

Type: Deployment Fix

Summary:

- Add the external synchronization queue and dead-letter queue as producers and
  consumers in every deployable Wrangler environment, and include them in the doctor
  binding contract.

Reason:

- The OAuth aggregation implementation and example configuration declared the queue
  contract, but the live production/staging configuration omitted it. Deployment
  therefore succeeded without the bindings required to enqueue initial or incremental
  synchronization work.

Verification plan:

- Run the focused Wrangler/Worker wiring tests and configuration doctor tests.
- Deploy production only after both queue resources exist.
- Re-read the active Worker version and queue inventory; require both bindings and one
  producer/consumer on each production queue before provider testing.

Result:

- The production queues were created, full verification passed with 2,554 application
  tests at 100% configured coverage plus 21 bridge tests, and Worker version
  `86ed7b09-8396-47f7-b39f-bd013d905802` deployed successfully.
- Live inventory reports one producer and one consumer for both
  `lumimail-external-sync-prod` and `lumimail-external-sync-dlq-prod`; the active Worker
  version exposes `EXTERNAL_SYNC_QUEUE` and `EXTERNAL_SYNC_DLQ_QUEUE` against those
  exact resources.
- The read-only production doctor passes 26/26, including seven unique live queues,
  exact active-version bindings, no pending migrations, public smoke, schedule, D1,
  R2, Email Routing, and Email Sending.
- Provider OAuth/encryption secrets remain a separate operator configuration step; no
  external account should be connected until those five secrets are present.

### 2026-08-15 — Implement OAuth aggregation MVP

Type: Feature

Summary:

- Added Google and Microsoft delegated OAuth lifecycle, encrypted tokens and cursors,
  bounded queue-driven import, idempotent external message mappings, provider-backed
  durable sending, prospective retained originals, lifecycle APIs, settings UI,
  compose sender selection, and external-source presentation.

Reason:

- Users need one Lumimail workspace for existing provider mail without granting
  destructive remote mailbox permissions or treating retained copies as a verified
  backup product.

Impact:

- Migrations `0037` and `0038`, an `EXTERNAL_SYNC_QUEUE` plus DLQ, five deployment
  secrets, and Google/Microsoft OAuth application redirect configuration are required.
  Existing native inbound/outbound and the client-facing IMAP/SMTP bridge remain
  available and unchanged in purpose.

Tests:

- `npm run verify` passed: 294 application test files / 2,435 tests at 100% statement,
  branch, function, and line coverage, plus 21 IMAP/SMTP bridge tests.
- Focused Playwright external-account and settings-shell suite passed 6/6 at desktop
  and 390 px coverage; all migrations through `0038` applied to a fresh local D1.

Notes:

- Controlled live Google/Microsoft tenant evidence, remote deployment, and restore
  rehearsal were not performed. OpenNext compilation reached a successful Webpack
  bundle but the repository-wide Next 16 route-wrapper type contract fails production
  type generation for existing routes (`RouteContext | undefined`); deployment dry
  run therefore remains pending and is not attributed to this feature as passed.

### 2026-08-15 — Define OAuth-first external mail roadmap

Type: Documentation Change

Summary:

- Defined the Google/Microsoft OAuth aggregation MVP, provider-backed sending,
  prospective exact-original retention, data/security boundaries, verification plan,
  and staged expansion through generic IMAP/SMTP, complete archive, and two-way sync.

Reason:

- Lumimail needs a safe product contract for consolidating users' existing mail without
  conflating its current client-facing IMAP bridge with external-account ingestion or
  prematurely promising destructive remote synchronization and verified backup.

Impact:

- No runtime behavior changes. This draft gives implementation a bounded first release
  and makes the larger roadmap, security decisions, and unresolved choices explicit.

Tests:

- Documentation-only change; links and repository references inspected manually.

Notes:

- Implementation must begin with this spec and update it as provider prototypes resolve
  the remaining scope, quota, storage, and deployment questions.
