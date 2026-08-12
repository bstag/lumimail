# F77 — Routing Authorization, Dependency, and IMAP Resource Hardening

> Status: Implemented locally; production authorization and bridge-host validation pending
> Owner area: `src/app/api/routing-rules/`, root dependency graph, `imap-bridge/`

## 1. Problem & User Job

Three production-security gaps remain after the end-to-end review: restricted organization members can call routing administration APIs directly, the installed dependency graph contains known high-severity advisories, and an unauthenticated IMAP client can grow a session command buffer without a bound. Operators need these boundaries enforced at the server and transport layers, independent of UI visibility.

## 2. Current Behavior

- Routing rule collection and item handlers use `withUser`, so any signed-in organization member can list, create, update, or delete rules and trigger Cloudflare catch-all changes.
- The root dependency graph resolves Next.js 16.2.11 and Wrangler 4.113.0; `npm audit --omit=dev` reports seven high-severity vulnerabilities through Next.js, Sharp/PostCSS, Wrangler/Miniflare/Undici, and brace-expansion.
- `ImapSession` appends bytes until CRLF arrives. It sets no idle timeout, and `startImapServer` accepts an unlimited number of simultaneous sessions.

## 3. Desired Behavior and Acceptance Criteria

- Every `/api/routing-rules` method requires organization owner/admin authorization. A restricted member receives the standard 403 envelope before any database or Cloudflare operation.
- Direct and transitive dependencies are upgraded only as far as needed to remove the known advisories while retaining the supported Next.js/OpenNext/Workers contract. No forced major upgrade is used.
- Local D1 migration and query-plan verification must select the application database rather than new Wrangler metadata databases.
- An IMAP session rejects and closes an overlong command before its retained partial-command buffer can grow beyond 64 KiB.
- An unauthenticated or authenticated idle IMAP session is closed after five minutes.
- The IMAP listener admits at most 100 concurrent sessions per process and releases capacity exactly once when a socket closes.
- Existing IMAP TLS, authentication, command, UID, and response behavior remains unchanged for compliant clients.

## 4. Scope Boundaries

In scope: routing API authorization, lockfile-compatible security upgrades, IMAP command-size/idle/concurrency limits, regression tests, and contract documentation.

Out of scope: new role types, per-IP/distributed connection quotas, edge-level rate limiting, SMTP resource-policy changes, and changing the privileged default IMAPS port/container user contract. Those controls can be layered operationally without weakening these process-local limits.

No database migration is required.

## 5. Error States and Edge Cases

| Condition | Result |
|---|---|
| Missing routing session or organization | 401 standard error envelope. |
| Organization role is `member` or missing | 403 standard error envelope; no DB/provider call. |
| Organization role is `owner` or `admin` | Existing tenant-scoped routing behavior continues. |
| IMAP command reaches the limit and ends in CRLF | Accepted when no command line exceeds the byte limit. |
| Partial or complete IMAP command exceeds 64 KiB | Send an untagged `BYE` when possible and destroy the socket. |
| Multibyte UTF-8 input | Enforce the byte limit, not JavaScript character count. |
| Socket is idle for five minutes | Send `BYE` when possible and destroy the socket. |
| 101st simultaneous IMAP connection | Refuse it without constructing a session. |
| Socket emits both `end` and `close` | Capacity is released once through the close event. |

## 6. Test Plan

- Unit: restricted members receive 403 for routing GET, POST, item GET, PATCH, and DELETE; database and provider mutation arrays/spies remain empty.
- Unit: both owner and admin retain access through the existing successful route cases.
- Bridge: fragmented and single-chunk overlong commands are rejected by byte length; exact-limit compliant commands remain processable; timeout closes the session.
- Bridge: listener rejects the connection above the cap and accepts another after a prior connection closes.
- Browser/local: a seeded restricted member receives 403 from a direct routing API request.
- Supply chain: `npm audit --omit=dev` and bridge audit report no known vulnerabilities.
- Full: `npm run verify`, `npm run e2e`, OpenNext production build, and Wrangler dry run.

## 7. Decisions

- Use the existing `withOrgAdmin` wrapper so routing follows the same server-enforced organization-administration boundary as domains and members. — 2026-08-06
- Use fixed conservative protocol limits (64 KiB, five minutes, 100 sessions) rather than new deployment configuration for this bounded repair. — 2026-08-06
- Keep the existing port/container privilege contract out of this patch; dropping privileges while binding default port 993 requires a separately designed port/capability migration. — 2026-08-06
- Upgrade the smallest supported dependency set and do not use `npm audit fix --force`. — 2026-08-06
- Pin the first patched stable Wrangler release, 4.114.0, rather than taking later unrelated runtime changes. — 2026-08-06

## 8. Open Questions

None blocking. Per-IP or distributed quotas should be selected from production traffic data in a later operational-hardening change.

## 9. Bug / Change Log

### 2026-08-06 — Close review findings 3, 4, and 5

Type: Security Fix

Summary: enforced routing administration roles at the API boundary, replaced vulnerable dependency resolutions, and bounded unauthenticated IMAP session resources.

Reason: UI-only access hiding is not authorization, known vulnerable packages should not ship when supported patched releases exist, and unauthenticated network input must not consume unbounded process memory or connections.

Tests: authorization and transport regressions, dependency audit, full repository verification, browser checks, production build, and deployment dry run as listed above.

Verification:

- `npm run verify` passes: 193 application test files, 1,759 tests, 100% configured statement/branch/function/line coverage, and 21 bridge tests. Lint reports only the repository's existing warnings.
- Routing-focused unit coverage passes 51 tests, including member denial before database/provider work for all five methods.
- The mocked Chromium suite passes all 71 scenarios.
- The new authenticated local routing scenario is present, but it did not execute because role-session setup failed closed with `Login rate limit unavailable`; the local Durable Object binding could not initialize in this environment. No browser authorization claim is made from that run.
- `npm audit`, `npm audit --omit=dev`, and the bridge production audit report zero known vulnerabilities.
- The OpenNext Cloudflare production build and Wrangler deployment dry run pass with all bindings resolved.
- Production deployment, a controlled restricted-member 403 request, and bridge-host load validation remain pending.
