# F43 — Production Password Recovery

> Status: Shipped
> Owner area: `src/app/forgot-password/`, `src/app/reset-password/`, `src/app/api/auth/forgot-password/`, `src/app/api/auth/reset-password/`, `src/lib/auth/`

## 1. Problem & User Job

Lumimail has partial password-reset API routes and a migrated token table, but it has no forgot-password or reset-password pages and the forgot route does not send mail. It also returns a raw reset link outside production, trusts the request `Origin` when constructing links, and checks candidate tokens by scanning bcrypt hashes.

A user who loses access needs a complete recovery flow delivered to their separate recovery address without revealing whether an account exists or exposing reusable reset credentials.

## 2. User Stories & Acceptance Criteria

- As a signed-out user, I can request recovery from the login page and always receive the same acknowledgement whether or not the account exists.
- Given an account with a recovery address, when recovery is requested, then the configured mail provider sends a one-hour reset link to that recovery address.
- Given an unknown account or an account without a recovery address, when recovery is requested, then no token is stored and no email is sent, while the public response remains identical.
- Given valid reset-link parameters, when I submit matching passwords of at least eight characters, then the password changes, all outstanding reset tokens are invalidated, existing sessions are revoked, and I can return to sign in.
- Given a malformed, expired, already-used, or concurrently claimed token, when reset is attempted, then the same safe invalid-token response is shown and no password changes.
- Reset tokens and reset links are never returned by APIs or written to logs.
- Unit and browser tests cover known/unknown accounts, delivery failure, expiration, reuse, success, and the public user journey.

## 3. Scope Boundaries

**In scope:**

- Forgot-password and reset-password public pages.
- Login-page recovery link.
- Transactional reset email through the existing outbound provider abstraction.
- Trusted application URL and reset sender configuration.
- Exact token-hash lookup and one-time token claiming.
- Generic responses that resist account enumeration.

**Out of scope:**

- Support-assisted account recovery.
- Recovery when no separate recovery address is configured.
- MFA or recovery codes.
- Durable retry queues for reset mail; provider failure is logged without sensitive details and the created token is removed.
- Strict response-time equalization between existing and unknown accounts.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `users` | `email`, `reset_email`, `password_hash` | Request is keyed by login email; delivery goes only to `reset_email`. |
| `password_reset_tokens` | all | Stores a SHA-256 digest of a high-entropy token, one-hour expiry, and used state. |
| `sessions` | `user_id` | All sessions are revoked after successful reset. |

No migration is required.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/auth/forgot-password` | Public | `{ email }` | `{ success: true, data: { message } }` | 400 only for malformed input; known/unknown/delivery outcomes share the success response. |
| POST | `/api/auth/reset-password` | Public | `{ email, token, newPassword }` | `{ success: true, data: { ok: true } }` | 400 `Invalid request` or `Invalid or expired token`. |

## 6. UI/UX

- `/login` links to `/forgot-password`.
- `/forgot-password` accepts the account email and replaces the form with the generic acknowledgement after success.
- `/reset-password` receives token and email from the emailed URL, validates password confirmation locally, and links back to sign in after success.
- Loading, validation, API, invalid-link, and success states are explicit.
- Pages reuse the existing public `AuthShell`; broader theme-token remediation remains R-15.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/auth/password-reset.test.ts` | Token hashing, trusted link construction, and email contents/provider call. |
| Unit/API | `tests/unit/app/api/auth/forgot-password/route.test.ts` | Validation, identical unknown response, storage, delivery, no token exposure, and safe delivery failure. |
| Unit/API | `tests/unit/app/api/auth/reset-password/route.test.ts` | Validation, hash lookup, expiry, claim/reuse failure, password update, token invalidation, and session revocation. |
| Unit/UI utils | `tests/unit/app/forgot-password/` and `tests/unit/app/reset-password/` | Canonical API parsing and form payloads. |
| E2E | `tests/e2e/password-recovery.spec.ts` | Login link, request acknowledgement, password mismatch, invalid token, and successful reset UI. |

## 8. Current Behavior

- No user-facing recovery pages exist.
- A token row is created for known users but no email is sent.
- Development responses expose the full reset URL and token.
- Link origin comes from a caller-controlled header.
- Reset scans every unused user token with bcrypt and marks only the selected token used.

## 9. Error States

| Condition | User-visible result | HTTP status | Logged? |
|-----------|---------------------|-------------|---------|
| Invalid forgot request | Valid email required | 400 | Existing development API logging policy |
| Unknown account/no recovery address | Generic acknowledgement | 200 | No |
| Mail/configuration failure | Generic acknowledgement | 200 | Generic operational message without address, token, link, or provider response |
| Missing/malformed reset fields | Invalid request | 400 | Existing development API logging policy |
| Expired/used/unknown/concurrently claimed token | Invalid or expired token | 400 | No sensitive details |

## 10. Edge Cases

- Email input is trimmed and lowercased.
- JSON parse failures return validation errors rather than unhandled exceptions.
- Reset links use configured `PUBLIC_APP_URL`, never `Origin` or `Host`.
- The provider receives both HTML and plain-text bodies.
- A failed email send deletes the newly created unusable token.
- Successful reset invalidates every outstanding token and session for that user.
- Token claiming is conditional on `used=false`, preventing two concurrent requests from both changing the password.
- Missing token/email query parameters show an invalid-link state without calling the API.

## 11. Permissions & Security

- Both endpoints are intentionally public.
- Recovery delivery goes only to the separately stored `reset_email`, never an address supplied as a delivery target in the request.
- Tokens are high entropy and stored only as deterministic SHA-256 digests so they can be looked up without scanning secrets; database disclosure does not reveal usable tokens.
- Public forgot responses do not distinguish user existence, recovery configuration, or provider delivery.
- Logs must not contain email addresses, raw tokens, reset links, provider response bodies, or credentials.

## 12. Open Questions / Decisions

- Decision: use the existing selected outbound provider so Cloudflare and Resend deployments share one recovery path. — 2026-07-22
- Decision: add explicit `PUBLIC_APP_URL` and `PASSWORD_RESET_FROM` configuration; inferred request origins are not trusted for credential links. — 2026-07-22
- Decision: remove development token/link responses entirely; automated tests mock delivery instead. — 2026-07-22
- Decision: hash reset tokens with Web Crypto SHA-256 instead of bcrypt. Reset tokens are random high-entropy secrets, and deterministic hashing permits constant-size exact database lookup. — 2026-07-22
- Decision: the production sender is `noreply@henriksen.dev`; Cloudflare CLI confirms `henriksen.dev` Email Sending is enabled. — 2026-07-22

## 13. Bug / Change Log

### 2026-07-22 — Complete password recovery

Type: Security Fix

Summary:

- Add complete public recovery UI, safe token handling, and transactional email delivery.

Reason:

- Existing API-only scaffolding could not recover a production account and exposed reset links during development.

Impact:

- Users with configured recovery addresses can reset forgotten passwords without account enumeration or token disclosure.

Tests:

- API, helper, UI utility, and browser regressions plus full repository verification.

Notes:

- 28 focused unit/API/helper tests pass; the full suite passes with 904 tests and 100% configured coverage.
- All 16 browser tests pass, including four recovery journeys.
- Cloudflare CLI confirms `henriksen.dev` Email Sending is enabled.
- OpenNext production build and Wrangler dry run pass with the expected email and recovery bindings.
- Worker version `e63887e2-a872-4fe9-8eb2-8d2282a05fef` deployed with 55 ms startup time; login, forgot-password, and reset-password return HTTP 200, and invalid forgot input returns 400.
- Controlled production validation passed: the recovery email arrived, the link completed the password change, and the new password successfully authenticated. No address, token, link, or password was recorded.
