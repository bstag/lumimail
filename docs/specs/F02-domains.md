# F02 — Domain Management

> Status: Shipped locally — production deployment verification pending
> Owner area: `src/app/api/domains/*`, `src/lib/domains/`, `src/app/(admin)/domains/`

## 1. Problem & User Job

Users need to connect their Cloudflare domains to Lumimail for email routing and sending. The admin provisions domains via the Cloudflare API, and the system manages DNS records automatically.

## 2. User Stories & Acceptance Criteria

- As an admin, I can add a Cloudflare domain to my workspace.
  - Given I enter a hostname, when I submit, then Cloudflare routing + sending DNS records are provisioned for that zone, and the domain appears in my domain list.
- As an admin, I can view DNS status for each domain (routing + sending).
  - Given I click "DNS" on a domain card, the current MX/TXT records and any missing records are shown.
- As an admin, I can explicitly verify or enable Cloudflare Email Sending for apex and nested hostnames.
- As an admin, I can remove a domain, cleaning up Cloudflare routing rules while preserving Email Sending onboarding whose ownership provenance is unknown.
- As a restricted organization member, I cannot list, inspect, create, verify,
  enable, or remove domains.
  - Given my organization role is `member`, every `/api/domains*` request returns
    `403` before D1 or Cloudflare domain operations run.
  - Given I navigate directly to `/domains`, the admin layout redirects me to
    `/inbox` before domain controls render.

## 3. Scope Boundaries

**In scope:** Owner/admin-only domain access; add domain (Cloudflare
provisioning), list domains with DNS status, view DNS details, explicitly
verify/enable sending, and remove the Lumimail domain with routing cleanup.

**Out of scope:** Edit domain fields (PATCH), non-Cloudflare domains, DNS propagation monitoring.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `domains` | `id`, `userId`, `organizationId`, `hostname`, `zoneId`, `status`, `routingStatus`, `sendingSubdomainTag`, `sendingEnabled`, `routingEnabled` | |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/domains` | `guardOrgAdmin` | query: `?includeDns=true` | `{ domains[], dns? }` | 401, 403 |
| POST | `/api/domains` | `guardOrgAdmin` | `{ hostname, enableRouting?, enableSending? }` | `{ domain, dns }` | 400, 401, 403 |
| GET | `/api/domains/[id]` | `guardOrgAdmin` | — | `{ domain }` | 401, 403, 404 |
| GET | `/api/domains/[id]/dns` | `guardOrgAdmin` | — | `{ routing: { records, missing, status }, sending }` | 401, 403, 404 |
| POST | `/api/domains/[id]/sending` | `guardOrgAdmin` | `{ action: "verify" \| "enable" }` | `{ domain, dns }` | 400, 401, 403, 404 |
| DELETE | `/api/domains/[id]` | `guardOrgAdmin` | — | `{ ok }` | 400, 401, 403 |

## 6. UI/UX

- `/domains` — card grid: hostname, routing and provider-backed sending status, Verify/Enable sending action, DNS button, trash button
- DNS card expands inline showing routing records, sending DNS, and any missing records
- "New domain" modal dialog with hostname input
- Empty state: "No domains yet"

## 7. Current Behavior

- `listUserDomains()` scopes by `organizationId`
- `addDomainForUser()` provisions via Cloudflare API, inserts/updates domain row
- `reconcileDomainSending()` exact-matches or explicitly onboards apex/nested hostnames and persists only provider-returned state
- `removeDomainForUser()` cleans up Cloudflare routing and deletes the row, but preserves Email Sending onboarding until provider-resource provenance is tracked
- `getDomainDns()` fetches routing and provider-tagged sending DNS details from Cloudflare
- The admin layout already requires an owner/admin organization role.
- The API routes currently use the general user guard, so a restricted member
  can bypass the UI and call domain operations directly.

## 8. Known Gaps

- Disabling/removing Cloudflare Email Sending is intentionally not exposed until resource ownership provenance is tracked.

## 9. Error States and Edge Cases

- An unauthenticated request returns `401`.
- An authenticated user without the `owner` or `admin` role returns `403`.
- Authorization fails before request parsing, domain lookup, D1 mutation, or any
  Cloudflare operation.
- Owner and admin roles retain identical domain-management capabilities.
- Cross-organization domain identifiers retain the existing `404` behavior for
  authorized administrators.

## 10. Test Plan

- Unit/API: every exported `/api/domains*` handler rejects the organization-admin
  guard response and does not call its domain or Cloudflare service dependency.
- Unit/API: owner/admin guard success retains existing list, detail, DNS,
  provisioning, sending-reconciliation, and removal contracts.
- Browser: the existing restricted-admin navigation scenario continues to prove
  that a member visiting `/domains` is redirected before controls render.
- Verification: run focused domain route tests, `npm run verify`, and the
  restricted-admin Playwright scenario.

## 11. Bug / Change Log

### 2026-07-28 — Restrict domain administration to organization administrators

Type: Security / Authorization Fix.

Implemented: Replaced the general authenticated-user guard on every domain
endpoint with the established organization-admin guard. Owners and admins retain
access; members fail with `403` before domain or provider work begins. The 30
focused domain route tests, full `npm run verify`, and all three restricted-admin
browser scenarios pass locally. Production deployment and a controlled direct-API
member check remain.

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.

### 2026-07-22 — Correct Cloudflare sending readiness

Type: Correctness / Provisioning Fix. See [F45](./F45-cloudflare-sending-domain-readiness.md) for provider contracts, safety decisions, and verification evidence.
