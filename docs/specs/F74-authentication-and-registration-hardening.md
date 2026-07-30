# F74 — Authentication and Registration Hardening

> Status: Shipped
> Owner area: `src/lib/auth/`, `src/lib/rate-limit.ts`, `src/app/api/auth/`, `src/app/register/`

## 1. Problem & User Job

Lumimail protects sensitive mailbox data, but its browser session, ordinary
registration, rate limiting, and organization-role lookup currently leave avoidable
security gaps:

- the browser copies the full 30-day session token into `localStorage`, defeating
  the protection provided by the existing HttpOnly cookie;
- after initial setup, any anonymous visitor can create a mailbox on the
  installation's primary domain;
- login and send limits live in a module-level `Map`, so counters are isolated per
  Worker isolate, disappear on eviction, and grow without durable cleanup;
- session role lookup filters only by user ID, not by the active organization.

The operator job is to run a private workspace whose browser credentials are not
readable by JavaScript, whose addresses are assigned intentionally, and whose
authentication limits and tenant roles remain correct across Worker isolates.

## 2. User Stories & Acceptance Criteria

- As a signed-in browser user, I authenticate with the `ep_session` HttpOnly cookie
  and no reusable session secret is returned to or stored by browser JavaScript.
  - Login and registration responses omit `token`.
  - API requests rely on same-origin cookies and do not synthesize an
    `Authorization` header.
  - An upgraded browser removes the legacy `lumimail-session-token` entry without
    reading or reusing it.
  - Protected and public route guards determine session state by calling
    `/api/auth/me`, even when no local-storage marker exists.
- As an organization administrator, I control who receives an address on the
  installation's primary domain.
  - The very first registration remains available to bootstrap the first owner.
  - Invitation registration remains available with a valid, identity-bound token.
  - Once a primary domain exists, ordinary registration without an invitation
    returns `403` and performs no user, organization, mailbox, or Cloudflare write.
  - The registration page explains that an invitation is required instead of
    presenting an address-claim form.
- As an operator, authentication and sending limits are shared by all Worker
  isolates.
  - Counters are persisted in D1 and incremented atomically.
  - Expired counters are removed, so the table cannot grow indefinitely from
    one-time actors.
  - Login retains its five-attempt, one-minute limit.
  - Sending retains its fifty-request, one-hour per-user limit.
  - Registration and password-recovery entry points receive explicit durable
    limits.
- As an organization member, my role is loaded only from my active organization.
  A stale or second-organization membership cannot supply authorization in the
  active tenant.

## 3. Scope Boundaries

**In scope:**

- cookie-only browser sessions;
- one-time cleanup of the legacy local-storage session key;
- invitation-only registration after the first owner exists;
- a D1-backed fixed-window limiter for login, registration, password recovery, and
  authenticated sending;
- active-organization filtering during session role lookup;
- documentation of a safe future public-registration contract;
- backlog documentation for findings 6–8 from the 2026-07-30 security review.

**Out of scope:**

- changing the unauthenticated first-run `/api/setup/domain` flow (security-review
  finding 3);
- implementing public self-service registration;
- multi-organization account switching;
- password-change session revocation;
- webhook transport/timeout isolation;
- request-body streaming and global browser security headers.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `rate_limits` | `key_hash`, `count`, `reset_at` | New D1 table; `key_hash` is the SHA-256 digest of the action and actor, and `reset_at` is indexed for cleanup. |
| `sessions` | existing columns | No schema change; browser use moves exclusively to the HttpOnly cookie. |
| `organization_members` | existing columns | Role lookup adds the active `organization_id` predicate. |

Migration: `drizzle/migrations/0027_add_durable_rate_limits.sql`.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| POST | `/api/auth/login` | none | existing login body | `{ ok, redirect }` plus HttpOnly cookie | `429` after five attempts per minute |
| POST | `/api/auth/register` | none for first owner; invitation thereafter | existing first-run or invite body | `{ redirect }` plus HttpOnly cookie | `403` ordinary post-bootstrap registration; `429` durable abuse limit |
| POST | `/api/auth/forgot-password` | none | existing recovery body | existing non-enumerating response | `429` durable abuse limit |
| POST | `/api/send` | session cookie | existing send body | unchanged | `429` after fifty accepted attempts per hour |

No browser authentication response returns a raw session token.

## 6. UI/UX

- `/register?token=<invite>` continues to show the identity-bound invitation form.
- A fresh instance continues to show first-run domain/account bootstrap.
- A configured instance opened without an invitation shows a short invite-only
  explanation and the existing sign-in path; it does not show username/password
  controls that the API will reject.
- Existing browser installations silently delete the old local-storage token.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/auth/client.test.ts` | no token storage/header; legacy-key cleanup; cookie-backed requests |
| Unit | `tests/unit/app/api/auth/login/route.test.ts` | response omits token and awaits durable limit |
| Unit | `tests/unit/app/api/auth/register/route.test.ts` | first owner and invite allowed; ordinary configured-instance registration denied |
| Unit | `tests/unit/lib/rate-limit.test.ts` | atomic fixed windows, reset, cleanup, trusted actor keys, D1 failures |
| Unit | `tests/unit/lib/auth/session.test.ts` | role query includes active organization |
| Migration | `tests/unit/db/migrations.test.ts` | fresh and upgraded D1 schema equals Drizzle |
| E2E | registration/authentication scenarios | configured registration is invite-only; cookie session works without local storage |

Coverage target: 100% for touched source files.

## 8. Current Behavior

- Login and registration set the session only in the `ep_session` HttpOnly cookie;
  their JSON bodies contain redirects but no reusable token.
- Browser authentication always checks `/api/auth/me` with same-origin cookies.
  Legacy local-storage tokens are deleted without disturbing mailbox state during
  ordinary navigation; login, logout, and `401` handling still clear
  account-scoped caches.
- First-run bootstrap and valid invitation registration are available. A
  configured instance denies every ordinary registration with `403`, and the
  registration page presents an invitation-required explanation.
- Login, registration, password recovery, and browser sending use SHA-256-keyed
  D1 counters. Expired counters are cleaned before an atomic upsert; storage
  failures return `503` rather than disabling protection.
- `getUserFromSession` filters role membership by both user ID and
  `users.organizationId`.

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|-------------|---------|
| Configured instance receives ordinary registration | `Registration requires an invitation` | 403 | no |
| Durable limit exceeded | route-specific existing limit message | 429 | no |
| D1 rate-limit operation fails | safe service-unavailable message; protected operation does not proceed | 503 | structured error |
| Missing/invalid session | existing `Unauthorized` behavior | 401 | no |
| Active organization has no membership row | role is `null`; admin guards return `403` | 403 | no |

Rate-limit storage fails closed for authentication, registration, password recovery,
and sending. A D1 outage must not silently disable abuse protection.

## 10. Edge Cases

- A legacy local-storage token exists but its cookie does not: the token is deleted
  and the user is treated as signed out.
- A valid cookie exists but local storage is empty or unavailable: authentication
  succeeds.
- Login response parsing fails: no secret is persisted; the existing error
  propagates.
- Concurrent attempts for one actor use one atomic D1 upsert; the count cannot lose
  increments.
- A request at the exact reset boundary starts a new window.
- Expired unrelated counter rows are deleted before the current counter is consumed.
- Cloudflare's trusted `cf-connecting-ip` header is used for anonymous limits;
  caller-controlled `x-forwarded-for` is not trusted.
- When no Cloudflare client IP is available (local/test traffic), all such traffic
  shares a conservative `unknown` actor.
- Invite registration is checked before the ordinary-registration denial.
- First-run registration is checked after determining that no primary domain exists.
- A user with memberships in two organizations receives only the role belonging to
  `users.organizationId`.

## 11. Permissions & Security

- Only the first owner can self-bootstrap without an invitation. Thereafter, an
  organization administrator creates identity-bound invitations under F49.
- The D1 limiter stores only a SHA-256 digest of action/actor keys, not raw IP
  addresses, email addresses, passwords, API keys, or session tokens.
- Rate-limit failure is fail-closed because credential checking and outbound sends
  are sensitive operations.
- Session cookies remain `HttpOnly`, `Secure`, `SameSite=Lax`, path `/`, and
  thirty-day lifetime.
- No Cloudflare token, password hash, API key, invitation token hash, rate-limit
  actor, or raw session token is returned by the changed APIs.

## 12. Public Registration Design (Future)

Public registration must be an explicit deployment mode, never the default. A safe
contract should include all of the following before implementation:

1. `REGISTRATION_MODE=invite|public`, defaulting to `invite`; changing it is an
   operator action recorded in deployment documentation.
2. Public users do not become owners of independent organizations that reference
   another tenant's domain. The operator must choose whether they join one managed
   public tenant or receive a deliberately isolated tenant/domain allocation.
3. Mailbox addresses begin as pending reservations. The address and routing rule
   are created only after verification and any required approval.
4. Recovery-email ownership is verified with a short-lived, single-use token before
   the account can receive or send mail.
5. Turnstile/bot defense, durable per-actor and per-identifier limits, registration
   quotas, reserved local parts (`admin`, `security`, `postmaster`, and operator
   configured names), and anti-enumeration responses are mandatory.
6. Sending remains disabled or heavily restricted until reputation/abuse checks
   pass. Operators need suspension, address reclamation, audit history, and quota
   controls.
7. Concurrent address claims use one database constraint/transaction, and
   Cloudflare provisioning is compensating/idempotent so a failed registration
   cannot leave a live orphaned route.
8. The privacy notice must disclose recovery-email use, mail metadata processing,
   webhook/provider egress, retention, and operator access.

Public mode is not accepted scope until these product choices are specified and
reviewed.

## 13. Deferred Security Backlog

### Finding 6 — Revoke sessions after password change

Future behavior: successful password change revokes every existing session and
issues a rotated session for the current browser, matching password-reset
revocation. It needs multi-device UX, failure atomicity, and tests proving a stolen
old cookie stops working.

### Finding 7 — Isolate webhook delivery

Future behavior: require HTTPS, validate redirect destinations, cap webhooks per
tenant, apply connect/response timeouts, and enqueue deliveries onto a dedicated
queue so a tenant-controlled endpoint cannot stall shared inbound/outbound mail
processing.

### Finding 8 — Harden browser request and response boundaries

Future behavior: compare mutation origins against configured `PUBLIC_APP_URL`,
fail closed when both `Origin` and `Referer` are absent where browser-cookie auth is
used, safely handle malformed headers, and add a nonce/hash-based CSP plus frame,
referrer, permissions, and content-type policies. The CSP design must account for
Next.js, the inline theme bootstrap, fonts, and service-worker assets.

## 14. Decisions

- Decision: ordinary registration becomes invitation-only after bootstrap; public
  mode is documentation-only in F74. Date: 2026-07-30.
- Decision: browser sessions use only the existing HttpOnly cookie. Date:
  2026-07-30.
- Decision: use D1 rather than the Workers Rate Limiting binding because the
  binding is per-location and eventually consistent, while these security limits
  need exact shared windows. Date: 2026-07-30.
- Decision: rate-limit storage fails closed. Date: 2026-07-30.
- Decision: security-review findings 6–8 are recorded but not implemented in this
  change. Date: 2026-07-30.

## 15. Bug / Change Log

### 2026-07-30 — Harden browser sessions, registration, limits, and tenant roles

Type: Security Fix / Behavior Change

Summary:
- Remove JavaScript-readable browser sessions, make configured instances
  invitation-only, replace isolate-local limits with D1 counters, and bind session
  roles to the active organization.

Reason:
- The 2026-07-30 API/web security review identified credential-exposure,
  unauthorized address provisioning, bypassable abuse controls, and a latent
  cross-tenant role lookup.

Impact:
- Existing cookies remain valid, but legacy browser local-storage tokens are
  removed. New non-invited users can no longer claim addresses after setup.

Tests:
- Unit, migration, documentation, and integration coverage passes at 100% across
  1,532 tests. Typecheck and the IMAP bridge's 16 tests pass. The full Chromium
  suite passes all 50 scenarios.

Notes:
- Findings 6–8 and the future public-registration contract are documented above.
