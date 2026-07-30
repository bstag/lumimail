# F01 — Authentication

> Status: Shipped (no automated tests yet)
> Owner area: `src/app/api/auth/*`, `src/lib/auth/`, `src/app/(login|register)`

## 1. Problem & User Job

A new self-hosted instance has no users. The first registration bootstraps the
instance: it creates a custom domain (via Cloudflare Email Routing), the first
user, and that user's primary mailbox. After bootstrap, additional users join only
through identity-bound organization invitations. Returning users log in with
email/password and get an HttpOnly session cookie.

## 2. User Stories & Acceptance Criteria

- As the first operator, I can register with a domain I own, a username, password,
  and recovery email, and the app provisions Cloudflare Email Routing + sending for
  that domain, creates my user, and creates my mailbox `<username>@<domain>`.
  - Given no primary domain exists, when I POST `/api/auth/register` with
    `{ domain, username, password, resetEmail }`, then a domain row, user row, and
    mailbox row are created and a session cookie is set.
- As a subsequent user, I can register only from a valid organization invitation.
  - Given a primary domain exists, ordinary registration without an invitation is
    rejected with `403` and performs no writes.
- As a returning user, I can log in with email + password and get a session
  cookie, redirected to `/inbox` if I have mailboxes, else `/onboarding`.

## 3. Scope Boundaries

**In scope:** first-run and invitation registration, login, logout, `me`
endpoint, session cookie lifecycle.

**Out of scope:** OAuth/SSO, email verification, password reset flow (resetEmail
is stored but no reset email is sent yet), multi-factor auth.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `users` | `id`, `email`, `resetEmail`, `passwordHash`, `name` | `email = "<username>@<domain>"`, lowercased/trimmed |
| `sessions` | `id`, `userId`, `tokenHash`, `expiresAt` | token is bcrypt-hashed, 30-day expiry |
| `mailboxes` | `id`, `userId`, `domainId`, `localPart`, `displayName` | created during registration |
| `domains` | (via `addDomainForUser`) | only on first-run registration |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/auth/register` | none for first owner; invitation thereafter | first-run or invitation body | `{redirect}` + `ep_session` cookie | 400 invalid body; 403 invitation required; 409 email exists; 429 limited; 502 setup failed |
| POST | `/api/auth/login` | none | `{email, password}` (`loginSchema`) | `{ok: true, redirect}` + cookie | 400 invalid body; 401 invalid credentials; 429 limited |
| POST | `/api/auth/logout` | session | — | `{ok: true}`, clears cookie + deletes session row | — |
| GET | `/api/auth/me` | session | — | current user (no `passwordHash`) | 401 if no/invalid session |

Validation schemas: `firstRunRegisterSchema`, `primaryDomainRegisterSchema`,
`loginSchema` in `src/lib/validators.ts`.

## 6. UI/UX

- `/register` — `register-client.tsx`. Shows first-run fields (domain) only when
  no primary domain exists yet.
- `/login` — `login-client.tsx`.
- Session cookie name: `ep_session` (`SESSION_COOKIE` in `src/lib/auth/session.ts`),
  httpOnly, `sameSite: lax`, 30-day `maxAge`.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/validators.test.ts` | `firstRunRegisterSchema`, `primaryDomainRegisterSchema`, `loginSchema` (done) |
| Unit | `tests/unit/lib/auth/session.test.ts` (TODO) | `hashSessionToken`/`verifySessionToken` round-trip, `createSession`/`getUserFromSession`/`deleteSession` against a test D1 |
| Integration | `tests/unit/app/api/auth/register.test.ts` (TODO) | first-run vs subsequent paths, duplicate email (409), duplicate mailbox (409), Cloudflare failure rollback (502) |
| Integration | `tests/unit/app/api/auth/login.test.ts` (TODO) | success + redirect logic (`/inbox` vs `/onboarding`), 401 on bad credentials |
| E2E | `tests/e2e/auth.spec.ts` (TODO) | register → onboarding/inbox redirect; login; logout clears session and redirects to `/login` on protected routes |

## 8. Current Behavior

As implemented (see `src/app/api/auth/register/route.ts`,
`src/app/api/auth/login/route.ts`, `src/lib/auth/session.ts`):

- First-run is detected by `getPrimaryDomain(env)` returning nothing.
- First-run registration: validates with `firstRunRegisterSchema`, lowercases
  `domain`/`username`, builds `email = username@domain`, checks for an existing
  user with that email (409 if found), inserts the user, then calls
  `addDomainForUser` (routing+sending enabled) and
  `ensureEmailRoutingRuleToWorker`. On any failure during domain/mailbox setup,
  the just-inserted user row is deleted and a 502 is returned.
- Subsequent registration requires a valid identity-bound invitation. Ordinary
  registration on a configured instance returns `403` before any write.
- On success, `createSession` issues a bcrypt-hashed session token stored in
  `sessions` and returned only as the `ep_session` HttpOnly cookie.
- Login looks up the user by email, verifies password with bcrypt, checks
  `userHasMailboxes` to decide redirect target, creates a session, sets cookie.
- `getUserFromSession` locates one session by an indexed SHA-256 digest, verifies
  its bcrypt hash, and scopes the membership role to the user's active organization.

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|--------------|---------|
| Invalid register/login body | Zod `flatten()` error object | 400 | no |
| Email already registered | `"Email already registered"` | 409 | no |
| Ordinary registration after bootstrap | `"Registration requires an invitation"` | 403 | no |
| Cloudflare domain/routing setup fails during first-run | underlying error message | 502 | no |
| Bad login credentials | `"Invalid credentials"` | 401 | no |
| No/invalid session on `/api/auth/me` | 401 | 401 | no |

## 10. Edge Cases

- Empty/whitespace username or domain — rejected by Zod (`min(1)`, regex on
  username).
- Duplicate email — 409, no partial rows left behind (rollback on insert paths
  that fail after the user insert).
- Cloudflare API down during first-run — user row rolled back; domain row from
  `addDomainForUser` may already be partially created — **not currently rolled
  back** (see Open Questions).
- Session token reuse after `expiresAt` — `getUserFromSession` filters with
  `gt(sessions.expiresAt, new Date())`, so expired sessions are treated as
  invalid (401).
- Concurrent registrations with the same username — both could pass the
  pre-check race and attempt insert; D1 unique constraints (if any) determine the
  final outcome — **not currently covered by a unique index/test** (see Open
  Questions).

## 11. Permissions & Security

- `passwordHash` must never be returned by `/api/auth/me` — verify with a test.
- Session tokens are bcrypt-hashed at rest; the raw token appears only in the
  HttpOnly cookie and is never exposed to browser JavaScript.
- `CF_TOKEN`/Cloudflare credentials are never returned to the client.
- Logout must delete the session row, not just clear the cookie (`deleteSession`).

## 12. Open Questions / Decisions

- Q: If `addDomainForUser` succeeds but `ensureEmailRoutingRuleToWorker` or the
  mailbox insert fails during first-run, is the domain row (and any Cloudflare
  DNS records already created) rolled back? → Currently **no** rollback of the
  domain/Cloudflare side. Decision needed before adding a regression test for
  this path.
- Q: Is there a unique index on `users.email` and on
  `(mailboxes.domainId, mailboxes.localPart)` at the DB level, or only the
  application-level pre-check? → Verify against `src/db/schema/` and
  `drizzle/migrations/` before writing the concurrency test.

## 13. Bug / Change Log

### 2026-07-30 — Apply F74 authentication and registration hardening

Type: Security Fix / Behavior Change

Summary:
- Browser sessions became cookie-only, post-bootstrap registration became
  invitation-only, limits moved to D1, and roles became active-organization scoped.

Notes:
- See [F74](./F74-authentication-and-registration-hardening.md) for the complete
  contract and future public-registration design.

### 2026-06-10 — Document current behavior (no code change)

Type: Documentation Change

Summary:
- Created this spec to capture existing register/login/session behavior as a
  baseline for adding tests.

Reason:
- `docs/MVP_SCOPE.md` requires every shipped feature to have a spec before further
  changes are made.

Impact:
- None (docs only).

Tests:
- None added in this change. `tests/unit/lib/validators.test.ts` already covers
  the Zod schemas referenced above.

Notes:
- See "Open Questions" before adding rollback/concurrency tests — those need a
  decision first.
