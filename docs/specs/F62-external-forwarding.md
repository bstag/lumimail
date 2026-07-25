# F62 — External Forwarding via Cloudflare Email Routing

> Status: In Progress — deployed; awaiting controlled external delivery
> Owner area: `worker.ts`, `src/lib/email/`, `src/lib/cloudflare-api.ts`, `/routing`, `/aliases`

## 1. Problem & User Job

Forwarding is currently a **live mail-loss path**, not merely an unimplemented feature.
The routing UI offers **Forward to address**, `/api/routing-rules` accepts and persists
`action: "forward"` with a destination, and `src/lib/email/inbound.ts:46` handles that
decision with a single `console.info`. An administrator can create a forwarding rule today
and every matching message is silently discarded — no delivery, no failure state, no error.
`src/lib/email/alias-targets.ts` produces the same inert `{ type: "forward" }` targets.

An organization administrator needs mail sent to an address on a connected domain to reach
an external mailbox they control, or to have Lumimail refuse to create the rule at all.

## 2. Architecture Decision

The option originally considered was provisioning a Cloudflare Email Routing rule whose
action is `forward`, so forwarded mail never reaches the Worker. Retrieval of the current
Cloudflare Email Routing documentation showed a better fit:
`ForwardableEmailMessage.forward(rcptTo, headers?)` is available inside the Worker's
`email()` handler and uses the same Email Routing forwarding primitive, so Cloudflare still
performs sender rewriting and preserves SPF/DKIM alignment. We do not implement SRS.

**Decision: forward from the Worker's `email()` handler, not by provisioning provider-level
forward rules.**

| | Worker `message.forward()` (chosen) | Provider forward rule |
|---|---|---|
| Canonical rule shape from F46/F60 | Unchanged — every address still routes to the Worker | Would need a second, conflicting rule shape per address |
| Store *and* forward the same message | Supported | Impossible; the message never reaches Lumimail |
| Group aliases with external members (F30) | Reachable later | Not reachable |
| Message passes through Lumimail storage | Yes — R2 and D1 retain it | No |
| SRS / SPF / DKIM alignment | Cloudflare | Cloudflare |

The last row is a genuine trade-off and must be stated to operators: with the chosen design a
forwarded message is also retained by Lumimail, which the provider-rule design would avoid.
This is consistent with how every other inbound message is already handled, and it is what
makes store-and-forward and audit visibility possible.

## 3. Scope Boundaries

**In scope:**

- Organization-owned forwarding destinations, registered through Lumimail and verified by Cloudflare.
- Forwarding from the `email()` handler for routing rules and aliases whose action is `forward`.
- Fail-closed rule creation: a rule targeting an unverified or unowned destination is rejected.
- Removing the silent-drop path so no configuration can discard mail without a visible state.
- Refusing destinations inside a Lumimail-managed domain, which would loop back into the Worker.

**Out of scope:**

- Implementing sender rewriting, DKIM re-signing, or bounce processing ourselves. Cloudflare owns these.
- Forwarding to unverified addresses under any circumstance.
- Per-message forwarding retry. `message.forward()` happens inside the inbound handler; a failure rejects the message at SMTP time so the sender's server retries, rather than Lumimail inventing a second delivery queue.
- Group aliases with external members (F30). This spec makes them possible but does not enable them.
- Migrating existing `action: "forward"` rules to working forwards. They are dead configuration and are disabled, not silently activated.

## 4. Data Model

New table `forwarding_destinations`:

| Column | Type | Null | Purpose |
|--------|------|------|---------|
| `id` | text pk | no | `fwd_` prefixed id |
| `organization_id` | text fk | no | Owning organization. Cascade on delete. |
| `address` | text | no | Normalized lowercase destination. |
| `verified_at` | integer timestamp | yes | Set when Cloudflare reports the address verified. |
| `last_checked_at` | integer timestamp | yes | When verification was last reconciled with Cloudflare. |
| `created_at` / `updated_at` | integer timestamp | no | Standard. |

Unique index on (`organization_id`, `address`).

**Cross-tenant note:** Cloudflare destination addresses are *account-level* and therefore
shared across every Lumimail tenant on the same Cloudflare account. Verification status alone
must never authorize forwarding, or organization A could forward to an address that
organization B verified. `forwarding_destinations` is the ownership record, and a forward is
permitted only when the row exists for the requesting organization **and** Cloudflare reports
that address verified.

## 5. API Contract

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/forwarding-destinations` | GET | List the organization's destinations with verification state. |
| `/api/forwarding-destinations` | POST | Register an address and ask Cloudflare to send its verification email. |
| `/api/forwarding-destinations/{id}` | DELETE | Remove ownership. Rules depending on it are rejected first. |
| `/api/forwarding-destinations/{id}/refresh` | POST | Reconcile verification state with Cloudflare. |

All require organization admin (`guardOrgAdmin`). `/api/routing-rules` and `/api/aliases` gain
a precondition: `action: "forward"` is accepted only when the destination is owned and verified,
otherwise 422 with the pending-verification reason.

Cloudflare calls used, all account-scoped:
`GET|POST /accounts/{account_id}/email/routing/addresses` and
`DELETE /accounts/{account_id}/email/routing/addresses/{identifier}`.

## 6. UI/UX

`/routing` keeps the **Forward to address** action but the destination field becomes a select
over verified destinations, with an inline "Add destination" flow. An unverified destination is
listed as **Pending verification** and cannot be selected. The rule cannot be submitted against
one. Until at least one destination is verified, the Forward action is disabled with an
explanation rather than silently accepting a rule that drops mail.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/email/forwarding.test.ts` | Owned+verified forwards; unowned, unverified, and managed-domain destinations refuse; forward failure rejects rather than drops. |
| Unit | `tests/unit/lib/cloudflare-api.test.ts` | Destination create/list/delete request shapes and verification parsing. |
| Unit | `tests/unit/app/api/forwarding-destinations/*` | Admin-only access, cross-tenant denial, duplicate registration. |
| Unit | `tests/unit/app/api/routing-rules/*` | `action: "forward"` rejected for unverified or unowned destinations. |
| Unit | `tests/unit/db/migrations.test.ts` | Migration `0018` on fresh and upgraded databases. |
| E2E | `tests/e2e/external-forwarding.spec.ts` | Forward action disabled without a verified destination; pending state visible; verified destination selectable. |

## 8. Current Behavior

`worker.ts` `email()` stores raw bytes to R2 and enqueues; all routing decisions happen later
in `processInboundMessage`, where the live `ForwardableEmailMessage` no longer exists. This is
why forwarding cannot work today even in principle: by the time Lumimail decides to forward,
the object capable of forwarding is gone. The forward branch therefore only logs.

## 9. Error States

| Condition | Result | Logged? |
|-----------|--------|---------|
| Rule creation names an unowned or unverified destination | 422, rule not persisted | No |
| Destination is inside a Lumimail-managed domain | 422, rule not persisted | No |
| `message.forward()` throws at receive time | `message.setReject()` so the sending server retries; message not silently dropped | Yes, without content |
| Cloudflare address API unavailable during registration | 502, no ownership row created | Yes |

## 10. Edge Cases

- A destination verified in Cloudflare but never registered in Lumimail is not forwardable by anyone.
- Revoking a destination must reject dependent rules before the ownership row is removed.
- A rule with both store and forward semantics forwards *and* stores; forwarding failure must not prevent storage.
- Existing dead `action: "forward"` rules are treated as disabled configuration and surfaced as requiring a destination, never activated silently.
- Forwarding is skipped for messages Lumimail itself generated, to avoid a loop with the vacation responder (R-27).

## 11. Permissions & Security

- Destination registration and rule changes require organization admin.
- Ownership is per organization; account-level Cloudflare verification is necessary but never sufficient.
- Destinations inside managed domains are refused to prevent a Worker-to-Worker loop.
- No recipient address or message content is logged.

## 12. Open Questions / Decisions

- Decision: forward from the Worker rather than provisioning provider forward rules, because it preserves the canonical F46/F60 rule shape, allows store-and-forward, and leaves group fan-out reachable. — 2026-07-24
- Decision: a forwarding failure rejects the inbound message at SMTP time instead of entering a Lumimail retry queue, so the sender's mail server owns the retry and Lumimail never claims a delivery it did not make. — 2026-07-24
- Decision: organization ownership of destinations is required in addition to Cloudflare verification, because Cloudflare destinations are account-level and would otherwise leak across tenants. — 2026-07-24
- **Open:** whether forwarded messages should also be retained in Lumimail storage by default, or only when a store rule also matches. Retention interacts with R-11 and should be settled with it.

## 13. Bug / Change Log

### 2026-07-24 — Make external forwarding real and fail closed

Type: Bug Fix / Feature

Summary:

- Add `forwarding_destinations` (migration `0018`) recording organization ownership of a destination, plus Cloudflare account-level destination create/list/delete and `getCloudflareAccountId`.
- Add `authorizeForwardDestination`, `selectForwardTargets`, `forwardInbound`, and `shouldRejectUndeliverable` in `src/lib/email/forwarding.ts`.
- Forward from `worker.ts` `email()` using `message.forward()`, because the queue consumer has no forwarding capability.
- Carry `organizationId` on forward routing decisions so forwarding is authorized against the owning organization.
- Reject `action: "forward"` at rule creation and update unless the destination is owned and verified.
- Remove the `console.info` branch in `processInboundMessage` that stood in for delivery.
- Add destination management to `/routing` with a verified-only selector.

Reason:

- Forward rules were creatable and matching mail was silently discarded. Tracked as R-09.

Impact:

- Forwarding now delivers through Cloudflare, which performs sender rewriting and preserves authentication alignment.
- A forward that cannot be delivered and has no storing mailbox is rejected at SMTP time, so the sending server retries rather than the message vanishing.
- Rules referencing unverified destinations are refused instead of accepted-and-dropped. **Existing dead forward rules stop being accepted on edit and must be re-pointed at a registered destination.**
- A routing or forwarding fault falls through to the ordinary store path, so this cannot make inbound worse than before forwarding existed.

Tests:

- 18 forwarding-authorization cases, 6 Cloudflare destination-API cases, 21 destination-route cases, 4 refusal-message cases, and new fail-closed cases on rule create/update.
- Three pre-existing tests asserted the old behavior and were updated to the new contract; the inbound test now asserts the consumer neither forwards nor logs a recipient.
- `npm run verify` passes with 1,352 tests across 156 files at 100% configured coverage.
- Both `tests/e2e/external-forwarding.spec.ts` Chromium scenarios pass.
- Migration `0018` reaches Drizzle parity on fresh and upgraded databases.

Notes:

- Deployed 2026-07-25 as version `0336c6ab-af1b-499c-85d7-7087cc76c33a` with migration `0018` applied and none pending; `/routing` returned 200 and unauthenticated `/api/forwarding-destinations` returned 401.
- Destination verification by a real recipient and a controlled forwarded message to an external mailbox both remain before this is Shipped and before R-09 is checked. No live `message.forward()` call has been exercised yet, so the delivery path itself is deployed but unproven.
- The `email()` handler now performs a D1 routing lookup per inbound message. Include this in the R-17 performance pass.
