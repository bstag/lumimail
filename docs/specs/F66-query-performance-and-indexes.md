# F66 — Query Performance, Indexes, and Session Lookup

> Status: In Progress — implemented and locally verified; not yet deployed
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
- Not deployed. Production timing under real load remains R-18's exercise; this item establishes plans and complexity only.
