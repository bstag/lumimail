# F46 — Domain Catch-All Routing

> Status: In Progress
> Owner area: `src/lib/email/routing.ts`, `src/lib/cloudflare-api.ts`, `src/app/api/routing-rules/`, `src/app/(admin)/routing/`

## 1. Problem & User Job

Lumimail stores domain-scoped routing rules and its internal matcher recognizes `*`, but creating that rule does not configure Cloudflare's zone-level catch-all. Cloudflare therefore never delivers an unknown recipient to the Worker unless an operator separately configures the provider. The API also accepts patterns such as `*@domain` that the matcher never recognizes, and the current priority-only evaluation lets a catch-all take mail away from a real mailbox.

An organization operator needs one predictable catch-all per domain so named aliases, explicit rules, and mailboxes keep their mail while otherwise unknown recipients are delivered to the selected fallback mailbox.

## 2. User Stories & Acceptance Criteria

- As an operator, I can create a catch-all for one selected domain and route unmatched recipients to a mailbox on that same domain.
- As an operator, I may type `*` or `*@selected-domain`; Lumimail stores and returns the canonical pattern `*`.
- A wildcard for a different domain, malformed wildcard, or full address from another domain is rejected.
- At most one catch-all routing rule may exist per domain.
- Creating a catch-all configures Cloudflare's single zone catch-all to deliver to the Lumimail Email Worker.
- Removing or changing the last Lumimail catch-all disables the provider catch-all only when it currently targets the configured Lumimail Worker; provider configuration that has drifted to another destination is not overwritten.
- Routing precedence is deterministic: alias, exact-address rule, local-part rule, direct mailbox, catch-all, then no match.
- Priority orders rules only within the same specificity; it cannot make a catch-all override a named recipient.
- Exact, local-part, direct-mailbox, catch-all, and no-match decisions remain isolated by domain.
- Cloudflare/API failures are visible and do not produce a successful rule response.

## 3. Scope Boundaries

**In scope:**

- Canonical pattern parsing and validation for `*`, `*@domain`, local parts, and full addresses.
- One internal catch-all per domain and same-domain mailbox validation.
- Cloudflare catch-all GET/PUT integration using the configured Email Worker name.
- Safe provider disable behavior when the last internal catch-all is removed or changed.
- Correct internal precedence and case-normalized address matching across domains.
- Routing-page guidance, filtering of target mailboxes to the selected domain, and actionable errors.

**Out of scope:**

- Mailbox membership/ACLs and sharing `support@` among users (R-12/R-13).
- Implementing external forwarding; forward decisions still have the R-09 limitation.
- Raw R2 object cleanup for unroutable mail (R-11).
- Provisioning aliases/groups as Cloudflare literal routes (F16/F30).
- Automatically changing an active provider catch-all that targets another Worker or forwarding address.
- Domain-admin role enforcement; the existing organization-member admin boundary remains until ACL remediation.

## 4. Provider and Data Model

Cloudflare exposes exactly one catch-all rule per zone at `GET/PUT /zones/{zoneId}/email/routing/rules/catch_all`. Its matcher is `{ type: "all" }`; the Lumimail provider action is `{ type: "worker", value: [configuredWorkerName] }`.

| Source | Field | Contract |
|--------|-------|----------|
| `routing_rules` | `domain_id` | Isolates every rule and catch-all to one Lumimail domain. |
| `routing_rules` | `pattern` | Canonical catch-all is `*`; named inputs remain normalized local parts or full addresses. |
| `routing_rules` | `mailbox_id` | A store target must exist in the same organization and selected domain. |
| Cloudflare catch-all | `enabled/actions/matchers` | Provider source of truth for whether unknown recipients reach Lumimail. |

No schema migration is required. Duplicate catch-alls are prevented by the tenant/domain-scoped write service after checking current state. Existing noncanonical rows are not silently rewritten; API reads expose them until an operator edits or replaces them.

## 5. API Contract

| Method | Route | Auth | Request | Success | Errors |
|--------|-------|------|---------|---------|--------|
| GET | `/api/routing-rules` | Session + organization | — | `{ rules }` | 400 no organization, 401 |
| POST | `/api/routing-rules` | Session + organization | Complete routing rule | Created rule with canonical pattern | 400 validation/target, 404 domain, 409 duplicate/provider conflict, 502 Cloudflare |
| PATCH | `/api/routing-rules/[id]` | Session + organization | Partial routing rule | `{ rule }` with canonical pattern | 400 validation/target, 404/cross-tenant, 409 duplicate/provider conflict, 502 Cloudflare |
| DELETE | `/api/routing-rules/[id]` | Session + organization | — | `{ ok: true }` | 404/cross-tenant, 502 Cloudflare |

Provider conflict means the selected zone already has an enabled catch-all that does not target this Lumimail Worker. Lumimail refuses to overwrite it and tells the operator to review Cloudflare Email Routing.

Action invariants:

- `store` requires `mailboxId` and clears `forwardTo`.
- `forward` requires a valid `forwardTo` and clears `mailboxId`.
- `reject` clears both target fields.
- A target mailbox must belong to the authenticated organization and the rule's domain.

## 6. UI/UX

- The pattern field explains `*` as “all otherwise unmatched addresses” and shows that a selected domain is already applied.
- The target mailbox list contains only mailboxes on the selected domain.
- The add button requires the action's target as well as domain and pattern.
- Catch-all creation explicitly says it enables the Cloudflare catch-all for that domain.
- Removing a catch-all warns through button/title copy that unmatched delivery will be disabled.
- API error text is shown rather than collapsed into a generic failure.
- Active rules are displayed in actual precedence order, highest priority first within a specificity group.

## 7. Current and Desired Behavior

### Current

- The POST validator accepts any nonempty pattern and PATCH does not use Zod.
- `*@domain` is stored but never matches.
- Internal rules are queried by domain, but a `*` rule can run before a real mailbox solely because of priority.
- Store targets are not checked for same-organization/same-domain ownership.
- Multiple catch-all rows can exist for a domain.
- No routing-rule mutation calls Cloudflare's catch-all endpoint.
- The UI lists mailboxes from every domain as possible targets.

### Desired

- Input normalization, target validation, uniqueness, provider provisioning, and internal precedence form one domain-scoped contract.
- Unknown recipients reach the Worker only after an explicit catch-all creation.
- Known aliases, explicit named rules, and real mailboxes are never swallowed by a wildcard.

## 8. Error States and Edge Cases

| Condition | Result |
|-----------|--------|
| `*` or matching `*@domain` | Normalize to `*`. |
| `*@other-domain` or another wildcard form | 400; no provider or DB mutation. |
| Full address uses another domain | 400. |
| Mixed-case/space-padded named input | Trim and lowercase before storing/matching. |
| Store target missing, cross-tenant, or from another domain | 400 without revealing mailbox details. |
| Existing internal catch-all | 409. |
| Enabled provider catch-all already targets Lumimail | Reuse it; do not issue an unnecessary PUT. |
| Enabled provider catch-all targets another destination | 409; preserve it. |
| Disabled provider catch-all | PUT worker action + all matcher + enabled true. |
| Delete last catch-all while provider still targets Lumimail | Disable provider catch-all, then remove internal row. |
| Delete while provider targets another destination | Preserve provider state and remove only the internal row. |
| Two domains use the same local part | Resolve only within the recipient domain. |
| Catch-all has greater numeric priority than exact/local/direct | Named decision still wins. |
| Matching store rule references a deleted mailbox | Skip the unusable rule and continue to the next valid decision. |
| No alias, named rule, mailbox, or catch-all | Return no decision; current inbound queue path logs and retains cleanup debt under R-11. |
| Cloudflare request fails | 502 and no claimed successful provider state. |

## 9. Permissions & Security

- Every rule and referenced domain is scoped to `user.organizationId` before provider access.
- Every mailbox target is scoped to both organization and rule domain.
- Cross-tenant rule/domain/mailbox identifiers return generic not-found/invalid-target responses.
- `CF_TOKEN`, provider credentials, and raw Cloudflare error bodies are never returned.
- The existing application lets any organization member administer routing. This bounded work preserves that behavior and must not be treated as safe restricted-user access before R-12/R-13.

## 10. Test Plan

| Layer | Coverage |
|-------|----------|
| Pattern unit tests | normalization and rejection for wildcard, local part, full address, case, whitespace, wrong domain |
| Matcher unit tests | alias/exact/local/direct/catch-all/no-match precedence, priority within specificity, missing target, two domains |
| Cloudflare client | get, reuse, conflict, enable, and safe disable request contracts |
| API POST/PATCH/DELETE | auth, tenant/domain/target validation, canonical output, duplicate, transitions, provider failures |
| UI utility/component | domain-filtered targets, readiness validation, provider-aware error copy, displayed ordering |
| Browser | create canonical catch-all and provider failure/conflict state without optimistic success |
| Full | `npm run verify`, relevant Playwright suite, OpenNext build, Wrangler dry run |
| Production | read-only provider inspection, then controlled create and two-domain mail-flow checks with user-selected test addresses |

## 11. Decisions

- Decision: `*` is the only stored catch-all token; matching `*@domain` is accepted as ergonomic input and normalized. — 2026-07-22
- Decision: specificity outranks numeric priority, and a real mailbox outranks catch-all, because catch-all means only otherwise-unmatched mail. — 2026-07-22
- Decision: one catch-all exists per domain because Cloudflare exposes one provider catch-all per zone. — 2026-07-22
- Decision: refuse to overwrite an enabled catch-all aimed elsewhere; safe coexistence is more important than automatic takeover. — 2026-07-22
- Decision: provider catch-all changes are explicit write actions, never GET/page-load side effects. — 2026-07-22

## 12. Open Questions

- Production acceptance for `henriksen.dev` requires that domain to be added to Lumimail and a controlled recipient/target mailbox selected by the user. This does not block the deployed implementation.
- `lucidkith.com` currently has an enabled Cloudflare catch-all that forwards externally. The operator must explicitly choose whether to retain that route or replace it with Lumimail; the application refuses automatic takeover.
- Resource ownership metadata is not stored. Safe disable therefore depends on inspecting that the current provider action still targets the configured Lumimail Worker.

## 13. Bug / Change Log

### 2026-07-22 — Define and provision per-domain catch-all routing

Type: Behavior Change / Correctness Fix

Summary:

- Canonicalize catch-all syntax, enforce domain-scoped targets and precedence, and connect catch-all writes to Cloudflare Email Routing.

Reason:

- An internal `*` row alone cannot receive unknown addresses, while the current matcher can swallow named mailboxes and silently ignores accepted wildcard forms.

Impact:

- Operators can intentionally assign otherwise-unmatched mail per domain without taking mail away from named recipients.

Tests:

- Pattern, matcher, provider-client, route, UI, browser, full verification, build/dry-run, and controlled production flows listed above.

Evidence:

- 985 tests pass with 100% configured statement, branch, function, and line coverage.
- Both Chromium catch-all scenarios pass; the repository's known development-server teardown issue leaves the outer command running after assertions.
- OpenNext production build and Wrangler dry run pass.
- Worker `3a99cabe-fbf6-4d1d-b5cb-5df76458b6c2` deployed with 49 ms startup; `/routing` returned HTTP 200 and unauthenticated rule creation returned 401.
- Read-only provider inspection before and after deployment proves deployment did not change existing catch-all rules: LucidKith remains enabled with its external forward and Henriksen remains disabled/drop.
- Read-only production D1 inspection shows one active domain (`lucidkith.com`) and no internal routing rules; `henriksen.dev` has not yet been added as a Lumimail inbound domain.
- Status remains In Progress until the operator resolves the LucidKith provider conflict and controlled exact/catch-all/no-match delivery is exercised across both domains.
