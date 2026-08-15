# F66 — Query Performance, Indexes, and Session Lookup

> Status: Shipped — implemented, deployed, and locally plus managed-D1 verified
> Owner area: `src/lib/auth/session.ts`, `src/db/schema/index.ts`, `drizzle/migrations/`

## 1. Problem & User Job

Lumimail has never measured its query behaviour. Reading the schema and the hot paths
shows two classes of problem, one of which degrades every authenticated request.

**Session authentication is linear in the number of active sessions.**
`getCurrentUser` selects *every* unexpired session row and bcrypt-compares the presented
token against each until one matches. The project's own Vitest configuration notes that
`bcrypt.compareSync` at cost 10 takes roughly 100 ms. With N active sessions the average
cost is N/2 comparisons, so twenty sessions add about a second to every authenticated
request and a hundred add about five. `deleteSession` repeats the scan and does not stop
at the first match.

**Seven tables carry no index at all.** SQLite does not create indexes for foreign keys,
so each of these is a full table scan on its most common filter:

| Table | Scanned by | Frequency |
|---|---|---|
| `sessions` | every authenticated request | highest |
| `routing_rules` | inbound routing, twice per message since F62 | every inbound message |
| `message_filters` | filter application | every stored message |
| `attachments` | message attachment listing | every message view |
| `api_keys` | bearer authentication | every API request |
| `password_reset_tokens` | recovery | rare |
| `webhook_deliveries` | delivery history | rare |

Additionally `messages` has no index supporting its most common query shape — filter by
mailbox, order by `created_at` descending — so every folder page scans and sorts.

An operator needs the application to stay responsive as sessions, messages, and domains
accumulate, and needs the cost of a request to be independent of unrelated data.

## 2. User Stories & Acceptance Criteria

- As a user, request latency does not grow as other people sign in.
- Given an authenticated request, when the session is resolved, then exactly one bcrypt comparison is performed regardless of how many sessions exist.
- Given a presented token that matches no session, then no bcrypt comparison is performed at all.
- Given the hot queries, when their plans are inspected, then each uses an index rather than a full table scan.
- Given a mailbox folder page, when messages are listed, then the query is served by an index covering both the mailbox filter and the date ordering.
- Given the schema gains a table, then a missing index on its filtered columns is visible rather than silent.

## 3. Scope Boundaries

**In scope:**

- Constant-time session lookup that preserves bcrypt verification.
- Indexes for the seven unindexed tables and for the message list ordering.
- Query-plan assertions for the hot paths, executed against a real migrated database.
- Documented targets so a regression is detectable rather than a matter of opinion.

**Out of scope:**

- Replacing bcrypt. It still verifies the matched row; only the *lookup* changes.
- Caching, read replicas, or denormalization. Indexing first establishes whether anything further is warranted.
- Queue throughput measurement. That is dominated by Cloudflare Queues rather than D1 and belongs with R-18's operational exercise.
- Load generation against production. Plans and complexity are measured locally against a seeded database; production timing belongs to R-18.

## 4. Data Model

`sessions` gains `token_lookup`, a SHA-256 hex digest of the session token, with a unique
index. `token_hash` keeps the bcrypt hash and remains the thing actually verified.

A digest is safe as a lookup key here because a session token is high-entropy random
material rather than a user-chosen password: it is not vulnerable to the dictionary
attack bcrypt exists to slow. Keeping bcrypt for verification means a leaked database
still does not yield usable tokens.

Existing sessions have no digest and cannot be back-filled, since the plaintext token is
not stored. They are deleted by the migration, which signs everyone out once. That is
preferable to a fallback scan, which would silently retain the linear cost.

New indexes:

| Table | Index |
|---|---|
| `sessions` | unique on `token_lookup`; `user_id` |
| `routing_rules` | `domain_id`; `organization_id` |
| `message_filters` | `user_id` |
| `attachments` | `message_id` |
| `api_keys` | `user_id` |
| `password_reset_tokens` | `user_id` |
| `webhook_deliveries` | `webhook_id` |
| `messages` | `mailbox_id, created_at` |

## 5. API Contract

No HTTP changes. Sessions issued before the migration stop working, so clients are
signed out once and sign in normally.

## 6. UI/UX

None, beyond every authenticated page becoming faster.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/auth/session.test.ts` | One bcrypt comparison on a hit; none on a miss; a wrong token whose digest collides is still rejected by bcrypt. |
| Integration | `tests/unit/db/query-plans.test.ts` | `EXPLAIN QUERY PLAN` for each hot query against a real migrated database asserts index use and no `SCAN` of a large table. |
| Integration | `tests/unit/db/migrations.test.ts` | Migration `0024` on fresh and upgraded databases. |

Query plans are asserted rather than timings, because wall-clock on a developer machine
is not a stable contract while an index name in a plan is.

## 8. Current Behavior

`getCurrentUser` and `deleteSession` both select all unexpired sessions and iterate.
`messageAccessCondition` builds a subquery over `mailbox_memberships`, which is indexed,
so it is not itself the problem; the tables it joins against are. Inbound processing
performs a routing-rule scan per message and a filter scan per stored message.

## 9. Error States

| Condition | Result | Logged? |
|-----------|--------|---------|
| Token matches no digest | Unauthenticated, no bcrypt performed | No |
| Digest matches but bcrypt fails | Unauthenticated | No |
| Session expired | Unauthenticated regardless of digest | No |

## 10. Edge Cases

- The digest must be computed with the same encoding on write and read, or every lookup misses.
- Expiry must still be enforced in the query; a valid digest for an expired session is not a session.
- Deleting a session must use the digest rather than a scan, and must be idempotent.
- The unique index on `token_lookup` means an improbable digest collision is a write error rather than silent overwrite.

## 11. Permissions & Security

- The digest is a lookup key only. Authentication still depends on the bcrypt comparison, so a leaked `token_lookup` column does not authenticate anyone.
- SHA-256 is appropriate here precisely because the input is high-entropy; this reasoning does not extend to passwords.
- No authorization behavior changes.

## 12. Open Questions / Decisions

- Decision: keep bcrypt for verification and add a digest for lookup, rather than replacing bcrypt. The linear cost comes from *finding* the row, not from verifying it. — 2026-07-25
- Decision: delete existing sessions rather than supporting a legacy scan path. A fallback would preserve the very cost this removes, and signing in again is a small one-time cost. — 2026-07-25
- Decision: assert query plans rather than durations, so the contract is stable across machines and CI. — 2026-07-25
- Decision: measure locally against a seeded database. Production timing under real load is R-18's exercise, and this item should not wait on it. — 2026-07-25
- Decision: no synthetic seed harness is built for *production shape*. Volume arrives as real domains are onboarded, and a fabricated distribution would characterise data the product does not have. — 2026-07-25
- Revision 2026-07-25: a local volume harness **was** built after all, once a restored production copy existed to seed on top of. Seeding 25,000 messages onto real schema and real mailboxes is not the fabricated distribution that was rejected — it is real structure at volume, and it immediately exposed a missing index that plan inspection alone had missed. Absolute production latency still belongs to R-18. — 2026-07-25

## 14. Performance targets

Measured against a local restore seeded to **25,000 messages** across four mailboxes
and two domains. These are **database** costs — the SQL the application issues, run
against SQLite — not end-to-end latency. Network, Worker startup, and rendering are
excluded deliberately: the gate concerns query plans, and a developer machine says
nothing useful about Cloudflare's network.

Reproduce with `node scripts/measure-query-cost.mjs`, which reports the median of 25
runs alongside each plan.

| Query | Target | Measured | Plan |
|---|---|---|---|
| Folder listing, first page | < 1 ms | 0.047 ms | `messages_mailbox_created_idx` |
| Folder listing, page 200 | < 10 ms | 4.074 ms | index; `OFFSET` walks skipped rows |
| Unread counts | < 10 ms | 3.737 ms | index scan over the mailbox |
| Search by subject/snippet | < 10 ms | 4.397 ms | index scan; `LIKE` cannot use an index |
| Thread fetch | < 1 ms | 0.011 ms | `messages_thread_created_idx` |
| Mailbox access subquery | < 1 ms | 0.004 ms | covering index |
| Session lookup | < 1 ms | 0.002 ms | `sessions_token_lookup_idx` |
| Routing rules for a domain | < 1 ms | 0.003 ms | `routing_rules_domain_idx` |

The table was reproduced on 2026-08-11 against migration `0028`; all eight local
database targets still pass. The fixture was reseeded immediately afterward.

Three of these deserve explanation rather than a number alone:

**Deep pagination** costs what it costs. `OFFSET 5000` walks five thousand index entries
before returning anything; that is inherent to offset paging, not a missing index. If
deep paging ever matters, the fix is keyset pagination — ordering by `(created_at, id)`
and passing the last row's values — not another index.

**Search and counts** scan the mailbox's messages. `LIKE '%term%'` cannot use a B-tree
index at all, so its cost grows with mailbox size. At 25,000 messages it is ~5 ms, which
is acceptable; if a single mailbox reaches hundreds of thousands, the answer is a
full-text index (FTS5), not tuning.

**Thread fetch** was the finding. It scanned the table and sorted into a temporary
B-tree at 4.658 ms; with `messages_thread_created_idx` it is 0.010 ms, and it now scales
with the size of the conversation rather than the size of the table.

## 13. Bug / Change Log

### 2026-07-25 — Constant-time session lookup and the missing indexes

Type: Bug Fix

Summary:

- Add `sessions.token_lookup`, a SHA-256 digest with a unique index, and resolve a session by one indexed lookup followed by a single bcrypt comparison.
- Delete a session by digest instead of scanning.
- Add ten indexes, including for seven tables that had none.
- Add `EXPLAIN QUERY PLAN` assertions for the hot paths.

Reason:

- Authentication bcrypt-compared the presented token against every unexpired session, at roughly 100 ms each, so latency grew with the number of people signed in. `deleteSession` did the same and did not stop at the first match, so every logout compared against every session. Seven tables had no index at all, SQLite not creating them for foreign keys. Tracked as R-17.

Impact:

- Request cost is now independent of session count. A token matching nothing costs no bcrypt at all.
- Inbound routing, filter application, attachment listing, and bearer authentication are index-served rather than scanning.
- Folder listing no longer builds a temporary B-tree to order by date.
- Migration `0024` deletes existing sessions, signing everyone out once.

Tests:

- Session cases asserting one comparison on a hit, none on a miss, and rejection when the digest matches but bcrypt does not.
- Nine query-plan assertions against a real migrated database.
- `npm run verify` passes with 1,446 tests across 162 files at 100% configured coverage plus 16 bridge tests.

Notes:

- Plans are asserted rather than durations, because an index name is stable across machines and a millisecond count is not.
- One assertion was initially over-specific: SQLite chose `mailbox_memberships_mailbox_role_idx` where `..._mailbox_user_idx` was expected, both leading on `mailbox_id`. The assertion was relaxed to require an index rather than a particular one; the schema was not changed to satisfy a test.
- `deleteSession` was worse than the spec's original description: it scanned *and* continued after matching.
- At the time of this change log the migration was not yet deployed. Production timing under real
  load remained R-18's exercise; this item established plans and complexity only.
- Deployment reconciliation 2026-08-13: migration `0024` and its later migrations are present in
  production. F84's read-only managed-D1 run proves `messages_mailbox_created_idx`,
  `messages_thread_created_idx`, `sessions_token_lookup_idx`, and `routing_rules_domain_idx` are
  active in WNAM with zero rows written. End-to-end HTTP latency and Queue throughput remain F84/R-17
  evidence rather than F66 implementation work.

### 2026-07-25 — Index the thread query, found by measuring at volume

Type: Bug Fix

Summary:

- Add `messages_thread_created_idx` on `(thread_id, created_at)` in migration `0025`.
- Add a query-plan assertion so it cannot regress.
- Add `scripts/measure-query-cost.mjs` and record measured targets in §14.

Reason:

- Fetching a conversation scanned the whole `messages` table and sorted into a temporary B-tree. The earlier audit missed it because it looked for tables carrying *no* index; `messages` had several, just none serving this shape. Seeding a restored copy to 25,000 messages made it obvious in one run.

Impact:

- Thread fetch drops from 4.658 ms to 0.010 ms and now scales with conversation size rather than table size. It is on the message-view path, so every opened conversation paid the old cost.

Notes:

- The lesson generalises: "does this table have an index" is a weaker question than "is there an index for the query this code issues". Plan inspection catches the first; volume catches the second.
- Deep pagination, search, and counts were measured and left alone. Their costs are inherent — `OFFSET` walks skipped rows, `LIKE '%x%'` cannot use a B-tree — and the honest fixes are keyset paging and FTS5 respectively, neither warranted at current scale. §14 records that rather than leaving them looking like oversights.
