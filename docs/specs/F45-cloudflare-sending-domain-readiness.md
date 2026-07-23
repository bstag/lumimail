# F45 — Cloudflare Sending-Domain Readiness

> Status: Shipped
> Owner area: `src/lib/domains/`, `src/lib/cloudflare-api.ts`, `src/app/api/domains/`, `src/app/(admin)/domains/`

## 1. Problem & User Job

Lumimail can successfully send through the Cloudflare Email Service Worker binding, but domain provisioning deliberately records every apex zone as `sendingEnabled = false`. Cloudflare now supports onboarding an apex hostname through the same sending-subdomains API used for nested hostnames, and production provider inspection confirms that both `lucidkith.com` and `henriksen.dev` are enabled sending domains. The database/UI can therefore contradict the provider and a real successful send.

The existing domain PATCH route also accepts client-supplied `sendingEnabled` and `routingEnabled` booleans without checking Cloudflare, allowing stored readiness to be fabricated.

Operators need a truthful, actionable view of sending readiness and an explicit way to verify or enable a domain without hidden provider mutations.

## 2. User Stories & Acceptance Criteria

- As an operator, I can onboard either an apex hostname or a nested hostname for Cloudflare Email Sending.
- As an operator, I can verify an existing domain against Cloudflare without changing Cloudflare configuration.
- As an operator, I can explicitly enable sending; Lumimail reuses exact existing provider onboarding or creates it when absent.
- `sendingEnabled` is true only when Cloudflare returns an exact, enabled sending-domain object.
- A client cannot directly set provider-backed readiness booleans.
- The domain UI distinguishes provider-ready, setup-needed, checking, and failed states and exposes sending DNS details.
- Existing inbound/routing behavior remains unchanged.
- Unit/API/browser tests cover apex onboarding, nested onboarding, stale-state correction, exact matching, cross-tenant denial, errors, and UI actions.

## 3. Scope Boundaries

**In scope:**

- Exact-hostname Cloudflare sending-domain discovery and onboarding for apex and nested domains.
- Provider-backed verification and persistence of `sendingEnabled` and `sendingSubdomainTag`.
- Explicit verify/enable API action and domain-page controls.
- Sending DNS diagnostics tied to the provider-returned tag.
- Removal of the legacy client-authored readiness PATCH behavior.
- Preservation of Cloudflare sending onboarding when removing a Lumimail domain because existing provider-resource ownership is not known.
- Correction of stale production state after provider verification.
- Documentation of the already-confirmed outbound production send without recording message content or addresses.

**Out of scope:**

- Sending another message without the user's explicit choice of recipient and timing.
- Marketing/bulk mail, quotas, suppression management, and analytics dashboards.
- Automatic background polling of Cloudflare.
- Changing the outbound provider abstraction or adding another provider.
- Domain-admin role enforcement; the existing organization-member domain boundary remains until the mailbox/admin ACL work.
- Catch-all behavior, tracked separately by R-08.

## 4. Provider and Data Model

Cloudflare is the source of truth for sending readiness.

| Source | Field | Meaning |
|--------|-------|---------|
| Cloudflare sending-domain object | `name` | Must exactly match the normalized Lumimail hostname. |
| Cloudflare sending-domain object | `enabled` | Authoritative provider-ready state. |
| Cloudflare sending-domain object | `tag` | Identifier used to retrieve required sending DNS records. |
| `domains` | `sending_enabled` | Cached provider state; never accepted from a client request. |
| `domains` | `sending_subdomain_tag` | Cached exact provider tag; cleared when no exact provider domain exists. |

No schema migration is required.

## 5. API Contract

### Cloudflare client

- `listSendingSubdomains(zoneId)` returns apex and nested sending-domain objects.
- `findSendingDomain(zoneId, hostname)` performs normalized exact matching.
- `ensureSendingDomain(zoneId, hostname)` reuses an exact object or creates the exact hostname.
- Sending-domain objects include at least `tag`, `name`, and `enabled`, with provider metadata optional.

### Lumimail route

| Method | Route | Auth | Request | Success | Errors |
|--------|-------|------|---------|---------|--------|
| POST | `/api/domains/[id]/sending` | Existing session + organization ownership | `{ action: "verify" \| "enable" }` | canonical `{ success, data: { domain, dns } }` | 400 invalid/provider failure, 401, 404 unknown/cross-tenant |

- `verify` lists and exact-matches provider state; it never creates or deletes Cloudflare resources.
- `enable` reuses an exact provider object or creates the hostname, then persists returned state.
- Unknown, other-organization, and inaccessible domain identifiers do not expose provider state.
- The legacy PATCH route no longer accepts readiness booleans.

## 6. UI/UX

- Each domain card always shows a sending state: **sending ready** or **sending setup needed**.
- A ready domain offers **Verify sending**.
- A not-ready domain offers **Enable sending** with wording that makes the Cloudflare mutation explicit.
- While an action runs, the button is disabled and shows checking/enabling progress.
- Success refreshes the domain card and DNS summary from the returned canonical data.
- Failure remains visible on the affected card and does not optimistically change readiness.
- DNS details show the provider state plus record types/details; the interface does not equate a non-empty required-record list with verified provider enablement.

## 7. Current and Desired Behavior

### Current

- `provisionDomainOnCloudflare()` hard-codes apex sending to false and skips Cloudflare sending-domain lookup entirely.
- Nested domains list/reuse/create provider objects correctly.
- `getDomainDns()` returns sending records only when the cached tag is present.
- The domain page hides all sending state when false, making disabled, pending, unsupported, and stale indistinguishable.
- PATCH `/api/domains/[id]` can directly rewrite readiness flags.
- The Cloudflare provider comment incorrectly implies arbitrary recipients require a different provider; the current paid Email Sending service supports arbitrary transactional recipients.

### Desired

- Apex and nested hostnames follow one exact provider contract.
- Verify and enable are explicit, tenant-scoped actions.
- Cached readiness is reconciled only from Cloudflare responses.
- UI status remains truthful and actionable.

## 8. Error States and Edge Cases

| Condition | Result |
|-----------|--------|
| Zone not found on configured Cloudflare account | Existing domain-add failure; no stored ready state. |
| Verify finds no exact sending domain | Persist false and clear cached tag; return setup-needed state. |
| Enable finds an exact disabled domain | Persist false and its tag; show provider not ready rather than claiming success. |
| Enable finds no exact domain | Create the exact apex/nested hostname and persist the returned state. |
| Cloudflare returns similarly named domains | Never use suffix/partial matching. |
| Cloudflare API/auth failure | Preserve prior stored state and show an actionable failure. |
| Provider domain removed externally | Next Verify changes cached readiness to false and clears its tag. |
| Required DNS records endpoint returns an empty list | Display no records; readiness still follows the provider `enabled` value. |
| Concurrent verify/enable | Last provider-backed result wins; no client-authored boolean is accepted. |
| Lumimail domain removed after provider discovery | Remove the Lumimail record but preserve Cloudflare Email Sending onboarding; disabling an unowned provider resource would be destructive. |

## 9. Permissions & Security

- All domain actions first resolve the domain by both ID and the authenticated user's organization ID.
- Provider calls occur only after ownership succeeds.
- Cloudflare tokens and full provider errors are not returned to the browser.
- The current codebase allows any organization member to manage domains. R-07 preserves that existing boundary; it does not make it safe to invite restricted members. Role/ACL remediation must constrain domain administration before multi-user rollout.
- Email Sending is transactional only; this feature does not introduce bulk sending.

## 10. Test Plan

| Layer | Coverage |
|-------|----------|
| Cloudflare client | exact match, no match, list/create/DNS endpoints, typed provider metadata |
| Provisioning service | apex reuse/create, nested reuse/create, disabled result, sending skipped |
| Domain service | verify found/missing, enable reuse/create, persistence, provider failure preserves state, DNS shape |
| API | auth, organization requirement, cross-tenant 404, invalid action, verify/enable success, provider failure |
| Legacy route | PATCH readiness mutation is unavailable |
| UI utilities | canonical request/response and safe error messages |
| Browser | stale false → enable/ready; ready → verify; action failure remains setup-needed |
| Full | `npm run verify`, relevant Playwright suite, OpenNext build, Wrangler dry run |

## 11. Production Validation

- Read-only Wrangler inspection on 2026-07-22 confirms `lucidkith.com` and `henriksen.dev` are exact enabled Cloudflare Email Sending domains with provider tags and sending DNS records.
- The user confirmed a successful outbound message from the deployed application before this remediation. No recipient, subject, body, or provider message ID is recorded.
- Production D1 reconciliation now records the exact enabled `lucidkith.com` provider state; the domain page and tenant guard are deployed for controlled UI verification.
- Do not send another message unless the user explicitly chooses the recipient and timing.

## 12. Decisions

- Decision: Cloudflare's exact sending-domain `enabled` field is authoritative; the presence of returned required-DNS records alone is not proof of readiness. — 2026-07-22
- Decision: use explicit verify and enable actions rather than mutating provider state during GET/page load. — 2026-07-22
- Decision: remove direct client PATCH control of provider-backed flags. — 2026-07-22
- Decision: do not delete Cloudflare Email Sending onboarding when a Lumimail domain is removed until resource ownership/provenance is explicitly tracked. — 2026-07-22
- Decision: preserve the existing organization-member domain permission boundary for this bounded correction and keep the restriction visible as a prerequisite to multi-user rollout. — 2026-07-22

## 13. Bug / Change Log

### 2026-07-22 — Make Cloudflare sending-domain readiness truthful

Type: Correctness / Provisioning Fix

Summary:

- Support apex onboarding, reconcile cached readiness from exact Cloudflare state, add explicit verify/enable controls, and remove client-authored readiness flags.

Reason:

- Production sending works while Lumimail incorrectly reports the apex domain as not sending-enabled.

Impact:

- Operators can trust and repair the sending state displayed for every configured domain.

Tests:

- Cloudflare client, provisioning/service, API, UI utility, browser, full verification, build, dry run, and controlled production status reconciliation.

Evidence:

- 88 focused unit/API contracts pass; the full gate passes with 936 tests and 100% configured statement, branch, function, and line coverage.
- Both new Chromium readiness scenarios and the updated DNS-detail scenario pass. The repository's known Playwright web-server teardown issue can leave the command running after completed assertions.
- OpenNext build and Wrangler dry run pass; Worker `d82e393c-1abb-4f68-9719-284eb31c73af` is deployed.
- Read-only Cloudflare inspection confirms exact enabled sending domains and sending DNS for `lucidkith.com` and `henriksen.dev`.
- Production D1 reconciliation changed the existing `lucidkith.com` cache from false/no-tag to enabled/has-tag; the domain page returns HTTP 200 and an unauthenticated sending action returns 401.
- The user previously confirmed a successful production outbound message. No message content, recipient, or credential is recorded.
