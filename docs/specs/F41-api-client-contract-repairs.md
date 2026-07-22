# F41 — API client contract repairs

> Status: Shipped
> Owner area: onboarding, admin domains/mailboxes/aliases, dashboard filters/labels, compose

## 1. Problem & User Job

Several browser clients parse canonical API envelopes as raw payloads. Successful requests can therefore look empty, safe server error messages are discarded, DNS details do not render, filter labels disappear, and compose skips attachment upload because it cannot find the nested message ID.

## 2. User Stories & Acceptance Criteria

- Domain and mailbox onboarding consume the canonical payload and show canonical errors.
- Domain creation and DNS detail loading consume canonical payloads and errors.
- The filters page loads the label array returned by `/api/labels`.
- Compose reads the returned message ID so selected attachments upload after a successful send.
- Alias, mailbox, label, filter, and domain creation failures show `error.message` rather than a generic fallback when available.
- Corrected canonical clients use `parseApiResponse` and have focused contract tests.

## 3. Scope Boundaries

**In scope:** confirmed mismatches listed above.

**Out of scope:** converting legacy/raw endpoints, redesigning forms, outbound queueing, attachment-before-send semantics, and unrelated API refactors.

## 4. Data Model

No database changes.

## 5. API Contract

Corrected clients consume the F40 canonical success/error envelope. Existing raw GET endpoints for domain and mailbox lists remain raw and are not passed to the canonical parser.

## 6. UI/UX

- Existing layouts and success flows remain unchanged.
- Safe server error messages replace generic failures.
- DNS details and filter labels populate from the actual payload.
- Attachments selected before sending proceed to the existing upload loop after the send result supplies `messageId`.

## 7. Test Plan

| Layer | Coverage |
|---|---|
| Unit | Onboarding, domain requests, filter requests, compose send request, canonical errors. |
| Full | `npm run verify`. |
| E2E | Run `npm run e2e`; document environmental blockers or results. |

## 8. Current Behavior

Clients use incompatible local casts instead of the F40 parser. The server routes already return canonical envelopes for the affected operations.

## 9. Error States

Canonical errors are surfaced through `ApiResponseError`. Malformed envelopes produce `Invalid API response`. Existing React Query/form error presentation remains responsible for displaying the thrown message.

## 10. Edge Cases

- Success payloads without required feature fields are rejected by the consuming helper where necessary.
- A sent message without `messageId` must not silently claim attachment upload succeeded.
- Raw list endpoints remain on their documented parser.
- Authentication redirects remain handled by `authFetch`.

## 11. Permissions & Security

No authorization changes. Clients display only the canonical safe error message.

## 12. Open Questions / Decisions

- Decision: repair only confirmed canonical consumers in this item; legacy endpoint migration remains separately scoped. — 2026-07-22
- Decision: keep attachment upload ordering unchanged; queueing and atomic attachment semantics belong to later email-flow work. — 2026-07-22

## 13. Bug / Change Log

### 2026-07-22 — Repair canonical API consumers

Type: Bug Fix

Summary: Adopt the shared response parser in confirmed mismatched clients and add contract regression tests.

Reason: Prevent successful canonical responses from being treated as missing data and preserve safe server errors.

Impact: Onboarding, DNS details, filter labels, compose attachments, and affected creation errors behave consistently.

Tests: Focused unit tests, full verification, and E2E where supported.

Verification:

- Four focused unit files passed 14 contract tests covering onboarding, domain creation/DNS, filter/label loading, send result parsing, and attachment upload errors.
- `npm run verify` passed: 110 test files, 870 tests, and 100% reported statement, branch, function, and line coverage; lint retained 43 existing warnings and no errors.
- Added authenticated, network-isolated Playwright flows for filter labels, DNS details, and send-then-attachment upload.
- `npm run e2e` passed all 11 tests.
- OpenNext production build completed successfully.
- Deployed Worker version `7b6a11f5-9159-40c4-8415-d447393a39fe` to `mail.henriksen.dev`.
- Live `/login` smoke check returned HTTP 200 and Lumimail HTML.
- E2E logs exposed separate compose translation defects; they are recorded under R-14 and were not silently expanded into this change.
