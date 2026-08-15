# F78 — Local-Equivalence MVP Readiness

> Status: Shipped (local-equivalence gate)
> Owner area: `tests/e2e-local/`, `scripts/`, `docs/MVP_SCOPE.md`, `docs/OPERATIONS.md`

## 1. Problem & User Job

Lumimail's MVP registry mixes deterministic application contracts with claims that
only an external provider or public deployment can establish. Several application
behaviors are implemented and unit-tested but remain open only because the same
paths have not been exercised against a real local D1 database and local Cloudflare
bindings.

The operator wants deterministic behavior to be considered proven when the exact
production code, migrations, schema, and binding shapes pass against a
production-equivalent local environment. Claims owned by an external provider,
public network, or recipient client must remain explicitly external rather than
being inferred from Miniflare.

## 2. User Stories & Acceptance Criteria

- As an operator, I can distinguish release-ready code from externally verified
  infrastructure without keeping deterministic code gates open indefinitely.
- Given a seeded real local D1 database, a restricted member cannot read or mutate
  domain or routing administration through direct API requests.
- Given an unscoped message request, the member receives messages from every
  permitted mailbox and no message from an unrelated mailbox.
- Given nested labels in the real database, the owner can list the hierarchy and
  browse a nested label without crossing the authenticated user's boundary.
- Given provider-shaped D1 reference results and R2 objects around the retention
  threshold, the production sweep reports and deletes old orphans while preserving
  referenced and recent objects.
- Given a D1/R2 backup fixture, restore verification detects missing objects,
  checksum changes, foreign-key failures, and schema drift.
- Given the local site, the repeatable smoke command exits non-zero on a failed
  assertion and zero when every expected public/auth boundary responds correctly.
- Given a traced mail-flow contract, one stable trace identifier connects inbound
  acceptance, persisted message state, reply submission, queue state, and provider
  payload without logging message content or credentials.

Local equivalence closes only application-controlled behavior. It does not establish
recipient rendering, Cloudflare Email Routing delivery, public TLS/reachability,
remote D1/R2 restore mechanics, Queue service throughput, or production latency.

## 3. Scope Boundaries

**In scope:**

- Real-backend Playwright coverage for authorization, all-mailboxes isolation, and
  nested label browsing.
- Deterministic retention deletion using the production retention implementation,
  explicit D1 reference fixtures, and an R2-compatible test binding.
- Local backup/restore integrity checks and smoke-command automation.
- A deterministic application-level traced mail-flow contract.
- Reconciliation of MVP/spec/operations evidence under the local-equivalence rule.

**Out of scope:**

- Deploying a Worker or bridge.
- Calling production Cloudflare resources or mutating production data.
- Sending mail to a real external recipient.
- Claiming measurements from local SQLite as production D1 latency.
- Claiming simulated R2, Queue, or Email bindings prove managed-service behavior.

## 4. Data Model

No production schema change. Test fixtures use the current append-only migrations.

| Table | Columns touched | Notes |
|-------|-----------------|-------|
| `organizations`, `users`, `organization_members` | fixture rows | Deterministic owner/member identities. |
| `domains`, `routing_rules` | fixture rows | Administration denial and positive controls. |
| `mailboxes`, `mailbox_memberships`, `messages` | fixture rows | Scoped and unscoped isolation. |
| `labels`, `message_labels` | fixture rows | One-level hierarchy and browse destination. |
| `message_bodies`, `attachments` | fixture rows | R2 referencedness and trace evidence. |
| `outbound_jobs` | fixture/runtime rows | Queued reply trace state. |

## 5. API Contract

No public API changes. Existing routes are exercised as contracts:

| Method | Route | Expected local-equivalence evidence |
|--------|-------|-------------------------------------|
| GET/POST | `/api/domains` | member `403` before inventory/provider work |
| GET/POST | `/api/routing-rules` | member `403` before inventory/provider work |
| GET | `/api/messages` | unscoped rows remain membership- and tenant-filtered |
| GET | `/api/labels` | authenticated user's hierarchy only |
| GET | `/api/messages?labelId=...` | nested-label browse remains message-authorized |
| GET/POST | `/api/admin/r2-retention` | owner-only report and exact-confirm deletion |

## 6. UI/UX

No new product UI. Browser evidence uses the existing mailbox selector, label view,
and administration APIs through authenticated sessions. Narrow-viewport coverage
includes the All mailboxes selector.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Real-backend E2E | `tests/e2e-local/isolation.spec.ts` | domain/routing denial plus scoped and unscoped mailbox isolation |
| Real-backend E2E | `tests/e2e-local/authenticated.spec.ts` | nested-label hierarchy/browse and All mailboxes behavior |
| Integration | `tests/unit/lib/r2-retention.test.ts` | production retention selection/deletion against referenced/recent/orphan fixtures and R2-compatible storage |
| Integration | `tests/unit/scripts/r2-backup.test.ts`, `smoke.test.ts` | backup checksum/missing-file and smoke command failure/success contracts |
| Integration | `tests/unit/lib/email/send.test.ts` | inbound RFC identifier across reply persistence, queue snapshot, and provider payload; outbound id across job/sent/webhook state |
| Full | repository commands | `npm run verify`, `npm run e2e`, and `npm run e2e:local` |

## 8. Prior Behavior

- Domain routes used `withOrgAdmin`; routing routes did so on the current working
  tree. Unit tests proved guard ordering, but real-backend routing denial had not
  completed because the persisted local D1 database was missing later migrations.
- The unscoped message route always applies `messageAccessCondition`; its real-row
  cross-tenant behavior has not been exercised by the local suite.
- Nested labels have unit and mocked-browser coverage but no real-backend browse.
- Retention selection/deletion is comprehensively mocked; production reported no
  eligible orphan, so deletion has not been observed against a persisted object.
- `scripts/smoke.mjs` is repeatable but is not exposed as an npm command and has no
  executable regression test.
- Backup and local restore helpers exist; operations documentation conflicts about
  whether the R2 local restore path was actually exercised.
- No single automated contract follows one trace identifier across the full
  application-controlled inbound-to-reply flow.

The local harness now migrates before seeding, eliminating schema-dependent login
failures. Real-backend tests supply positive and negative rows rather than treating
an empty response as isolation evidence.

## 9. Error States

| Condition | Result |
|-----------|--------|
| Local bindings cannot initialize | Local-equivalence suite fails; gate remains open. |
| Saved session is stale | Setup signs in again and validates `/api/auth/me`. |
| Restricted request fails for an unrelated reason | Positive control on an allowed route must also pass. |
| Unscoped list omits an allowed mailbox | Test fails; isolation cannot be "proved" by returning nothing. |
| R2 object is referenced or younger than seven days | It is preserved. |
| Backup object is missing or changed | Verification exits non-zero. |
| Smoke target is unavailable or returns a wrong status | Smoke command exits non-zero. |
| Trace identifier is lost between stages | Trace test fails at the missing boundary. |

## 10. Edge Cases

- Test fixtures must not expose rows from a restored production copy sharing the
  local database.
- All-mailboxes proof needs at least two permitted mailboxes and one forbidden
  mailbox; an empty result is not a positive isolation proof.
- Nested-label proof needs a top-level label, child label, linked permitted message,
  and an unrelated user's label/message.
- Local R2 fidelity does not include remote service latency, lifecycle rules,
  multipart behavior, or provider-side authorization.
- A passing local smoke run proves the script and app boundary, not that a later
  production deployment ran it.
- The trace identifier must be metadata only and must not require logging content,
  passwords, session tokens, or provider credentials.

## 11. Permissions & Security

- Cross-tenant negative cases are mandatory and paired with positive controls.
- Local fixtures use `e2e.test` identities and prefixed IDs only.
- No real provider credentials are required or emitted.
- Destructive retention and restore tests operate only on isolated local/test
  storage, never the production resources named in `wrangler.jsonc`.

## 12. Open Questions / Decisions

- Decision: deterministic application behavior may close an MVP gate through
  local equivalence when the exact production code, migrations, schema, and binding
  shape are exercised. — 2026-08-11
- Decision: external-provider, public-network, managed-service performance, and
  recipient-client claims remain operator checks. — 2026-08-11
- Decision: documentation will use **locally proven** or **release-ready**, not
  **production-verified**, for evidence that never reached production. — 2026-08-11

## 13. Bug / Change Log

### 2026-08-11 — Close deterministic MVP gates by local equivalence

Type: Documentation Change / Test Hardening

Summary:

- Define a falsifiable local-equivalence standard.
- Add real-backend and executable evidence for deterministic readiness gates.
- Reconcile the MVP registry so only genuinely external work remains assigned to
  the operator.

Reason:

- Route existence and mocked responses are insufficient evidence, while requiring
  a production incident-shaped exercise for deterministic code behavior is
  unnecessary when the same artifact can be exercised faithfully and repeatedly.

Tests:

- Focused message-route and local-binding tests pass, including the label-owner
  predicate and migration-before-seed contract.
- Smoke command tests pass both 6/6 success and fail-closed wrong-status cases.
- The deterministic traced reply/provider contract passes.
- `npm run e2e:local`: 52/52 against migrated local D1 and the actual site.
- `npm run e2e`: 71/71 mocked Chromium contracts.
- `npm run verify`: 194 application files / 1,764 tests at 100% configured
  coverage, plus 21 IMAP bridge tests; lint reports 36 pre-existing warnings and
  zero errors.
- The 25,000-message local query run meets all eight documented database targets;
  the local fixture was reseeded to 13 messages afterward.
- Production smoke 2026-08-11: 6/6 against `https://mail.henriksen.dev` — public
  landing/login/manifest returned 200 and all three anonymous API boundaries
  returned 401.
- Production mail trace 2026-08-11: one stored inbound Gmail RFC identifier is
  identical across reply storage, `References`, and the immutable queue snapshot;
  inbound and outbound rows share one thread; the outbound message and job are
  `sent` after one attempt with no error; Cloudflare returned an RFC Message-ID;
  and the operator confirmed exactly one external reply arrived. The D1 inspection
  selected identifiers/status metadata only and wrote zero rows.
