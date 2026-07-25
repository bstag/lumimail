# F40 — API response contract

> Status: Shipped
> Owner area: `src/lib/api/`, browser API consumers under `src/app/` and `src/components/`

## 1. Problem & User Job

Lumimail has a canonical server response envelope, but browser clients repeatedly redefine and cast response shapes. Some clients expect payloads or errors at the top level even when the server returns them under `data` or `error.message`. These casts compile while causing silent empty states, generic failures, and skipped follow-up work.

Developers need one runtime-checked client parser so successful data and API errors are interpreted consistently.

## 2. User Stories & Acceptance Criteria

- As a browser client, I can parse a successful canonical response and receive only its typed `data` value.
- As a browser client, I receive the server's safe error message and HTTP status when a canonical error response is returned.
- Given malformed JSON, a malformed envelope, or an unsuccessful HTTP response claiming success, the parser rejects it as an invalid API response.
- Existing legacy/raw routes remain behaviorally unchanged until migrated in an explicitly tested group.

## 3. Scope Boundaries

**In scope:**

- Canonical response types for `{ success: true, data }` and `{ success: false, error: { message } }`.
- A client-safe parser with runtime structural checks.
- A typed error containing the HTTP status.
- Unit tests for success, server errors, malformed bodies, and contradictory HTTP/envelope states.
- An inventory of canonical and legacy/raw route groups.

**Out of scope:**

- Repairing individual page/component consumers; tracked as R-05.
- Converting every legacy/raw endpoint in one change.
- Changing authentication redirects in `authFetch`.

## 4. Data Model

No database changes.

## 5. API Contract

Canonical success:

```json
{ "success": true, "data": {} }
```

Canonical error:

```json
{ "success": false, "error": { "message": "Safe user-facing message" } }
```

The client parser returns `data` for a successful 2xx response. It throws `ApiResponseError` for a structurally valid error envelope. Invalid JSON, invalid envelopes, or non-2xx success envelopes throw an invalid-response `ApiResponseError` without exposing arbitrary response content.

Current route-group inventory as of 2026-07-25:

| Contract | Route groups |
|---|---|
| Canonical envelope | `admin/r2-retention`, `aliases`, `attachments`, `auth/forgot-password`, `auth/reset-password`, `contacts`, `domains` create/detail/DNS, `filters`, `forwarding-destinations`, `labels`, `mailboxes` create, `messages/*/attachments`, `messages/*/labels`, `messages/*/retry`, `org`, `routing-rules`, `send`, `setup/domain`, `v1/send`, `vacation`, `webhooks/[id]` |
| Mixed canonical and legacy/raw | `auth/register` (canonical for selected errors; raw for success and other errors), `domains` (raw list; canonical mutations/details), `mailboxes` (raw list/detail; canonical create), `webhooks` (raw list/create; canonical item mutations) |
| Legacy/raw | `api-keys`, `auth/change-password`, `auth/login`, `auth/logout`, `auth/me`, `drafts`, message list/detail/search/count/status/bulk routes, `seed`, `settings/profile`, `setup/status`, `v1/messages` |

`guardUser` and `guardOrgAdmin` still return a bare `{ error: string }` for 401/403,
so an otherwise-canonical route can produce that shape at its authentication
boundary. Clients must therefore accept both a bare string and `error.message`.

Nested route variants inherit the listed family only where their handlers actually import the canonical response helper. R-05 must confirm the individual handler before migrating a client.

## 6. UI/UX

No direct UI changes. Corrected user-visible flows are part of R-05.

## 7. Test Plan

| Layer | File | What it covers |
|---|---|---|
| Unit | `tests/unit/lib/api/client-response.test.ts` | Runtime parsing, safe error extraction, status preservation, malformed response rejection. |
| Existing unit | `tests/unit/lib/api/response.test.ts` | Server helper continues emitting the canonical shape. |
| Full | `npm run verify` | Typecheck, lint, coverage, regression suite. |

E2E is deferred to R-05 because this item has no consumer/UI change.

## 8. Current Behavior

- `apiSuccess` and `apiError` produce a consistent envelope.
- Browser consumers manually call `response.json()` and assert one-off types.
- Legacy/raw endpoints coexist with canonical endpoints without a shared client distinction.
- Type assertions do not validate runtime response structure.

## 9. Error States

| Condition | Parser behavior |
|---|---|
| Valid success envelope + 2xx | Return `data`. |
| Valid error envelope | Throw its safe message and preserve status. |
| Invalid JSON | Throw `Invalid API response` with status. |
| Invalid envelope | Throw `Invalid API response` with status. |
| Success envelope + non-2xx | Throw `Invalid API response` with status. |

## 10. Edge Cases

- `data` may legitimately be `null`, `false`, `0`, or an empty collection.
- Error messages must be non-empty strings.
- Additional envelope properties are ignored.
- The parser must not depend on `window` and must be safe in client or server modules.
- A status of `0` from a constructed/test response is preserved.

## 11. Permissions & Security

- The parser does not alter authentication or authorization.
- It exposes only the server's canonical safe error message, never arbitrary details or malformed body content.
- Endpoint handlers remain responsible for preventing cross-tenant disclosure.

## 12. Open Questions / Decisions

- Decision: use strict parsing only for canonical endpoints; legacy/raw endpoints must not be passed to it until migrated. — 2026-07-22
- Decision: reject a non-2xx success envelope because transport and body state contradict one another. — 2026-07-22
- Decision: preserve the HTTP status on typed errors for callers that need status-specific UI. — 2026-07-22

## 13. Bug / Change Log

### 2026-07-22 — Establish a canonical client response parser

Type: Refactor

Summary:

- Add runtime-checked canonical response types and a shared parser.
- Document canonical versus legacy/raw route groups.

Reason:

- Eliminate unsafe one-off casts that concealed API/client contract mismatches.

Impact:

- No endpoint or UI behavior changes until consumers adopt the parser in R-05.

Tests:

- Focused parser unit tests and full project verification.

Notes:

- Added `ApiResponse<T>`, `ApiSuccessResponse<T>`, `ApiErrorResponse`, `ApiResponseError`, and `parseApiResponse` in `src/lib/api/client-response.ts`.
- The parser regression suite failed before implementation and passed afterward.
- Focused verification passed 15 tests with 100% statement, branch, function, and line coverage.
- `npm run verify` passed: 107 test files, 861 tests, and 100% reported coverage; lint reported the same 43 existing warnings and no errors.
- E2E was not run because no consumer or UI behavior changed in this item.

### 2026-07-25 — Migrate the routing-rules group to the canonical envelope

Type: Bug Fix

Summary:

- Convert every `/api/routing-rules` and `/api/routing-rules/[id]` response to `apiSuccess`/`apiError`.
- Reduce Zod failures to a single readable message via `firstZodMessage`, because the envelope carries a string rather than a nested flatten object.
- Teach `readRoutingResponse` to unwrap the envelope and to read `error.message` as well as a bare `error` string.
- Update the routing page's rules query to go through that parser rather than casting the raw body.

Reason:

- `routing-rules` was the last legacy/raw group reachable from a page that also calls canonical endpoints. F62 added `/api/forwarding-destinations` alongside it, and because `readRoutingResponse` read `error` as a string, every enveloped failure — including "Register this forwarding destination before using it" — was displayed as the generic "Routing request failed". The inconsistency was actively hiding the specific reasons F62 exists to surface.

Impact:

- The routing page now shows the real refusal reason when a forwarding destination is rejected.
- `/api/routing-rules` responses change shape. Any external consumer reading `{ rules }` or `{ error }` directly must read `data.rules` and `error.message`. The parser still accepts the bare `{ error: string }` that `guardUser` returns at the authentication boundary.

Tests:

- Ten route assertions updated from the bare shape to the envelope; these asserted the old contract and had to change with it.
- Two new parser cases: the envelope on success and failure, and the bare guard string.
- Four routing E2E mocks updated to the real contract so the browser tests are not validating a fiction.

Notes:

- Verified in production before the change that `/api/routing-rules` returned `{"error":"..."}` while `/api/forwarding-destinations` returned the envelope.
