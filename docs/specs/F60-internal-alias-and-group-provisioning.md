# F60 — Internal Alias and Group Provisioning

> Status: `Ready for Production Validation`
> Owner area: alias admin UI/API, alias/group schema, Cloudflare Email Routing,
> inbound target resolution

## 1. Problem & User Job

Lumimail has alias and group tables plus partial inbound expansion logic, but the
admin surface cannot manage group members and alias creation does not provision
an Email Routing rule in Cloudflare. A group member is currently represented as
a user and resolved indirectly to a mailbox on the alias domain, which is
ambiguous for a multi-domain organization and creates per-member queries.

The UI also claims external forwarding works even though the inbound Queue
consumer only logs forward decisions.

**User job:** as an organization administrator, create an address on any managed
domain that delivers to one internal mailbox or fans out to selected internal
mailboxes across the organization, without manually creating a Cloudflare rule.

## 2. User Stories & Acceptance Criteria

- As an organization admin, I can create `info@domain-a` targeting a mailbox on
  domain A or another organization-owned domain.
- As an organization admin, I can create `team@domain-a` with 2–50 explicit
  organization mailbox targets and later change that membership.
- Creating an alias ensures an enabled exact-address Cloudflare Email Routing
  rule targets the configured Lumimail Worker before the alias is reported as
  created.
- A Cloudflare provisioning failure does not leave an active D1 alias.
- Deleting a Lumimail-owned exact rule fails safely if Cloudflare cannot remove
  it; the D1 alias remains active.
- A provider rule that already targets the Worker is reused and never claimed
  as Lumimail-owned or deleted later.
- Inbound simple aliases and groups resolve explicit mailbox IDs across managed
  domains with no per-member mailbox lookup.
- The API and UI never expose or accept cross-organization mailbox targets.
- The UI does not claim external forwarding is available.
- Acceptance: a simple alias and a multi-mailbox group created entirely in
  Lumimail receive controlled inbound messages without manual Cloudflare rule
  creation.

## 3. Scope Boundaries

**In scope:**

- Internal single-mailbox aliases.
- Internal multi-mailbox group aliases.
- Exact Cloudflare Worker-rule provisioning and owned-rule cleanup.
- Explicit cross-domain mailbox targets within one organization.
- Group membership create/update UI and API.
- Truthful removal of external-forward creation claims.
- Migration of legacy internal user-based group members where an unambiguous
  same-domain mailbox exists.

**Out of scope:**

- External forwarding and external group members. R-09 remains open because it
  requires authenticated sender rewriting, loop prevention, durable retries,
  and failure visibility.
- Nested groups.
- Group-specific outbound sending identities.
- Per-member delivery preferences.
- Importing or deleting manually managed Cloudflare rules.

## 4. Data Model

| Table | Columns touched | Notes |
|---|---|---|
| `aliases` | add `cloudflare_rule_id` | Set only when Lumimail created the exact provider rule. `null` means the rule was reused or no ownership is known. |
| `group_members` | add `mailbox_id` | Explicit internal target with `ON DELETE CASCADE`; new writes do not use `user_id` or `email`. |
| `domains` | read `hostname`, `zone_id`, `organization_id`, status | Alias source domain must be active and organization-owned. |
| `mailboxes` | read ID/address/organization | Every target must belong to the authenticated organization. |

Migration `0016_add_alias_group_provisioning.sql` adds both nullable columns,
indexes group membership by alias/mailbox, and backfills a legacy `user_id`
member only when the user has a mailbox on the alias domain.

## 5. API Contract

| Method | Route | Auth | Request | Response | Errors |
|---|---|---|---|---|---|
| GET | `/api/aliases` | org admin | — | aliases with explicit mailbox members and owned-route state | 401/403 |
| POST | `/api/aliases` | org admin | `{kind:"mailbox",domainId,localPart,targetMailboxId}` or `{kind:"group",domainId,localPart,mailboxIds}` | created alias/address | 400, 404, 409, 502 |
| PATCH | `/api/aliases/[id]` | org admin | `{mailboxIds:[...]}` for group aliases | updated member IDs | 400, 404, 409 |
| DELETE | `/api/aliases/[id]` | org admin | — | `{ok:true}` | 404, 502 |

Rules:

- Local parts are trimmed and lowercased before lookup and storage.
- A group has 2–50 unique mailbox IDs.
- A source address cannot conflict with an existing mailbox or alias.
- All source and target rows are constrained to the authenticated organization.
- Client-supplied Cloudflare IDs, organization IDs, external addresses, user
  IDs, and provider ownership flags are ignored/rejected by validation.

## 6. Cloudflare Provisioning Contract

- List exact Email Routing rules for the source zone and address.
- Reuse an enabled rule already targeting `CF_EMAIL_WORKER_NAME`.
- Otherwise create one exact literal `to` rule targeting that Worker.
- Return whether the rule was created during this operation.
- Persist the provider rule ID only for a newly created rule with a usable ID.
- If the D1 batch fails after provider creation, best-effort delete only that
  newly created rule and return an internal error.
- Delete only the stored Lumimail-owned rule ID. Never infer ownership from a
  matching manually created rule.
- If owned-rule deletion fails, return HTTP 502 and keep the D1 alias/group.

## 7. UI/UX

- `/aliases` loads organization domains, all organization mailboxes from the
  admin mailbox endpoint, and aliases with group membership.
- Creation mode explicitly selects **Mailbox alias** or **Group alias**.
- Mailbox aliases require one target mailbox.
- Groups use labeled mailbox checkboxes, require at least two members, and show
  a bounded member count.
- Existing groups expose membership editing and a Save action.
- Creation, update, loading, empty, and provider error states are visible.
- External forwarding controls and claims are removed; a short note identifies
  it as planned rather than operational.
- Controls wrap and remain usable at mobile widths.

## 8. Current Behavior

- `POST /api/aliases` writes D1 without calling Cloudflare.
- `DELETE /api/aliases/[id]` leaves provider rules untouched.
- The UI can create a simple mailbox target or an external-forward record but
  cannot create or edit a real group.
- `group_members` has no API/UI writer.
- Internal group users are resolved to a mailbox on the alias domain using one
  query per member; explicit cross-domain targets are impossible.
- A simple cross-domain target passes API validation but is discarded during
  inbound resolution.
- Forward decisions are logged and not delivered.

## 9. Error States

| Condition | User-visible message | HTTP |
|---|---|---|
| Invalid shape, duplicate members, fewer than two group members | Validation failed | 400 |
| Source domain or target mailbox outside organization | Not found | 404 |
| Existing mailbox/alias at source address | Address already exists | 409 |
| Cloudflare exact-rule creation fails | Failed to provision Cloudflare routing rule | 502 |
| D1 write fails after creating provider rule | Failed to create alias | 500 |
| Owned Cloudflare rule deletion fails | Failed to remove Cloudflare routing rule | 502 |
| Updating a non-group alias as a group | Alias is not a group | 409 |

## 10. Edge Cases

- Duplicate and case-variant local parts.
- Duplicate mailbox IDs.
- Cross-domain target mailboxes in the same organization.
- Cross-organization mailbox IDs.
- Deleted target mailbox/group member.
- Empty legacy group.
- Existing manual Worker rule versus newly created owned rule.
- Provider creation succeeds but D1 write fails.
- Concurrent duplicate create requests.
- Group update while a mailbox is deleted.
- Alias domain is pending/error or lacks a usable zone ID.
- Catch-all is enabled: exact alias provisioning remains valid and independent.

## 11. Permissions & Security

- `guardOrgAdmin` protects every alias/group route.
- Source domains, aliases, and target mailboxes are organization constrained.
- Provider rule IDs are server-derived and never accepted from the browser.
- Cloudflare credentials remain Worker secrets and are never returned.
- The inbound resolver follows persisted explicit mailbox IDs; it never trusts
  recipient-controlled headers for tenant selection.
- External forwarding remains disabled until R-09 defines its security and
  deliverability contract.

## 12. Test Plan

| Layer | Coverage |
|---|---|
| Validators | discriminated create shapes, normalized local part, unique bounded groups, rejected external fields |
| Cloudflare API | existing-rule reuse, created ownership result, exact normalized address |
| Alias API | auth, tenant isolation, conflicts, cross-domain internal targets, provider failure, D1 compensation, group create/update, safe delete |
| Inbound resolver | simple and group cross-domain delivery, bounded query count, deleted members, no external pseudo-delivery |
| Schema migration | columns, indexes, foreign keys, legacy internal backfill |
| Browser | create group, edit members, visible provider errors, no external-forward claim |
| Production | provider exact rule plus controlled simple-alias and group delivery |

Run `npm run verify`, focused Chromium alias contracts, OpenNext build, migration
parity, and Wrangler dry run before deployment.

## 13. Decisions

- R-26 completes internal aliases/groups only; external forwarding stays R-09
  and is removed from the operational UI claim. — 2026-07-24
- Group members reference explicit mailbox IDs rather than users, because users
  can access multiple mailboxes across domains. — 2026-07-24
- Same-organization cross-domain targets are supported. — 2026-07-24
- Persist only provider rules Lumimail created, so deletion cannot remove a
  manual rule merely because it looks equivalent. — 2026-07-24
- Exact rules are provisioned even when a Worker catch-all exists, so an alias
  remains explicit and does not depend on catch-all policy. — 2026-07-24

## 14. Bug / Change Log

### 2026-07-24 — Specify truthful internal alias and group provisioning

Type: `Feature | Correctness | Security | Behavior Change`

Summary:

- Defined explicit mailbox-backed aliases/groups, Cloudflare route ownership,
  cross-domain internal delivery, group management, and removal of the false
  external-forwarding claim.

Reason:

- The existing UI/API and runtime imply capabilities that are not provider
  provisioned or externally delivered, and the user-based group model is
  ambiguous for Lumimail's multi-domain mailbox architecture.

Tests:

- Planned validator, provider, API, routing, migration, browser, build, and
  controlled production coverage.

### 2026-07-24 — Implement and locally verify internal aliases/groups

Type: `Feature | Correctness | Security | Behavior Change | Performance Fix`

Summary:

- Added migration `0016` for Lumimail-owned Cloudflare rule IDs and explicit
  mailbox-backed group members, including an unambiguous legacy-member backfill.
- Replaced ambiguous alias input with strict mailbox/group contracts, normalized
  local parts, bounded unique membership, and organization-scoped target checks.
- Added exact Cloudflare Worker-rule reuse/ownership reporting, provider-first
  provisioning, D1-failure compensation, and owned-rule-only deletion.
- Added group membership listing/updating and a responsive admin UI backed by
  the complete organization mailbox inventory.
- Removed external-forward creation and operational claims while retaining a
  truthful legacy-row indication.
- Reworked inbound alias delivery so simple aliases and explicit groups can
  target mailboxes across organization domains; explicit groups resolve in one
  bounded member query rather than per-member mailbox lookups.

Tests:

- `npm run verify` passes with 1,285 application tests at 100% statement,
  branch, function, and line coverage plus all 16 IMAP bridge tests.
- Executable migration/schema parity passes with `0016`.
- The focused Chromium internal-group contract passes.
- The full 42-scenario Chromium suite passes 39 scenarios. The three failures
  are pre-existing development-harness/navigation instability: two
  `ERR_ABORTED` redirect cases and one detached owner-menu element. The F60
  scenario passed in both focused and full runs.
- The OpenNext production build and Wrangler deployment dry run pass.

Not yet verified:

- Production migration application.
- A provider-created exact alias rule and controlled simple-alias delivery.
- Controlled fan-out from one group address into at least two internal
  mailboxes, including a cross-domain target.
