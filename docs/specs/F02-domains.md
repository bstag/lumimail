# F02 — Domain Management

> Status: Shipped
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

## 3. Scope Boundaries

**In scope:** Add domain (Cloudflare provisioning), list domains with DNS status, view DNS details, explicitly verify/enable sending, and remove the Lumimail domain with routing cleanup.

**Out of scope:** Edit domain fields (PATCH), non-Cloudflare domains, DNS propagation monitoring.

## 4. Data Model

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `domains` | `id`, `userId`, `organizationId`, `hostname`, `zoneId`, `status`, `routingStatus`, `sendingSubdomainTag`, `sendingEnabled`, `routingEnabled` | |

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|--------|-------|------|---------|----------|--------|
| GET | `/api/domains` | `guardUser` | query: `?includeDns=true` | `{ domains[], dns? }` | 401 |
| POST | `/api/domains` | `guardUser` | `{ hostname, enableRouting?, enableSending? }` | `{ domain, dns }` | 400, 400 (duplicate) |
| GET | `/api/domains/[id]/dns` | `guardUser` | — | `{ routing: { records, missing, status }, sending }` | 401, 404 |
| POST | `/api/domains/[id]/sending` | `guardUser` | `{ action: "verify" \| "enable" }` | `{ domain, dns }` | 400, 401, 404 |
| DELETE | `/api/domains/[id]` | `guardUser` | — | `{ ok }` | 401, 404 |

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

## 8. Known Gaps

- Organization roles are not yet enforced; any organization member can currently perform domain administration (tracked with F12 authorization work).
- Disabling/removing Cloudflare Email Sending is intentionally not exposed until resource ownership provenance is tracked.

## 9. Bug / Change Log

### 2026-06-10 — Backfill spec from existing implementation

Type: Documentation Change. No code changes.

### 2026-07-22 — Correct Cloudflare sending readiness

Type: Correctness / Provisioning Fix. See [F45](./F45-cloudflare-sending-domain-readiness.md) for provider contracts, safety decisions, and verification evidence.
