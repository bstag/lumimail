# F87 — OAuth-Protected MCP Integration

> Status: In Progress
> Owner area: `worker.ts`, `src/lib/mcp/`, OAuth routes, `/settings/mcp`

## 1. Problem & User Job

Lumimail has personal API keys, but an AI client should not receive a long-lived reusable key or
implicitly gain every capability attached to one. A signed-in user needs a standards-based remote
MCP connection with an explicit, narrow consent profile, immediate revocation, and the same dynamic
mailbox authorization used by the web app. Retried agent requests must never send duplicate mail.

## 2. User Stories & Acceptance Criteria

- A signed-in user can authorize a compatible MCP client with Authorization Code plus PKCE S256.
- Consent defaults to the read-only profile and names the requesting client, requested profile, and
  capability boundary before approval. Approval requires recent authentication for the exact
  browser session.
- A user can instead explicitly select the mail-action profile. Read-only grants can never invoke a
  mutating tool.
- A user can list and revoke their own connected clients from Settings. Revocation takes effect on
  the next request and never exposes a token, code, verifier, secret, or message content.
- Every tool call verifies the OAuth resource/audience, grant scope, approving browser session,
  current user and active organization, and current mailbox capability. Identifiers from another
  organization are indistinguishable from missing identifiers.
- A repeated send with the same connection and idempotency key returns the original accepted
  message. Reusing that key for different normalized input is rejected and cannot enqueue again.
- MCP exposes only the documented mail tools. It cannot administer organizations, domains,
  routing, credentials, sessions, audit history, operations, recovery, or updates.

## 3. Scope Boundaries

**In scope:**

- A same-origin remote MCP endpoint at `/mcp` using the current stateless Cloudflare Agents handler.
- OAuth protected-resource and authorization-server metadata, Authorization Code, PKCE S256,
  refresh-token rotation, hashed/encrypted provider storage, exact resource validation, expiry, and
  revocation through Cloudflare's Workers OAuth Provider.
- Two consent profiles: `mail.read` and `mail.actions`. `mail.actions` includes read plus bounded
  state changes, draft operations, and send/reply/forward; send-family tools require an explicit
  idempotency key.
- Initial tools: list permitted mailboxes, list/search conversations, get a message/thread, bounded
  attachment retrieval, message state changes, draft create/update/delete, and send/reply/forward.
- Personal connection management UI and content-free security events.

**Out of scope:**

- Organization or platform administration; domains; routing; API-key management; session/audit
  reads; backups; updates; arbitrary SQL; arbitrary URLs; bulk export; background autonomous runs.
- Token passthrough to another service, implicit OAuth, password grant, plain PKCE, wildcard
  redirect URIs, or a second authorization model.
- Supporting a separate integration origin in this slice.

## 4. Data Model

OAuth codes, hashed tokens, encrypted grant properties, clients, and provider revocation state live
in the dedicated `OAUTH_KV` binding owned by `@cloudflare/workers-oauth-provider`.

| Table | Columns touched | Notes |
|---|---|---|
| `mcp_connections` | id, user/org/session/client identity, profile, scopes, timestamps, revoked state | Secret-free user-facing connection inventory; its opaque ID is copied into provider grant metadata/properties so a listed grant can be correlated without storing its credential or provider grant ID. |
| `outbound_idempotency` | principal type/id, key, request hash, message/job identity, timestamps | Unique `(principal_type, principal_id, key)`; inserted in the same D1 batch as the durable outbound message and job. |
| `security_audit_events` | new MCP authorize/revoke/tool-mutation actions and connection resource | Content-free metadata only; no client-provided names, mail fields, query text, or identifiers from message content. |
| Existing mailbox/message/draft/attachment tables | existing columns only | Read and mutation services retain authoritative mailbox predicates. |

Migration: `0033_add_mcp_connections_and_idempotency.sql`.

## 5. Protocol and API Contract

| Method | Route | Auth | Contract | Errors |
|---|---|---|---|---|
| GET | `/.well-known/oauth-protected-resource` | public | Exact canonical MCP resource and authorization server metadata | 500 fail closed |
| GET | `/.well-known/oauth-authorization-server` | public | Provider metadata | 500 fail closed |
| POST | `/oauth/register` | public protocol endpoint | Provider-validated client metadata; IP-bounded compatibility registration; unverifiable software statements rejected; no Lumimail capabilities granted here | OAuth errors, 429/503 |
| GET | `/oauth/authorize` | browser session | Parse and validate authorization request, then show consent | 401, OAuth errors |
| POST | `/oauth/authorize` | recent exact session + CSRF-safe same-origin form | Approve the displayed read or action profile and create the connection | 400, 401, 403, OAuth errors |
| POST | `/oauth/token` | protocol client | Code exchange or refresh; PKCE S256 and exact resource | OAuth errors |
| POST | `/oauth/revoke` | protocol client | Provider revocation | OAuth errors |
| POST | `/mcp` | OAuth access token | JSON-RPC MCP transport | 401, 403, protocol/tool errors |
| GET | `/api/mcp/connections` | session | Current user's secret-free connections | 401 |
| DELETE | `/api/mcp/connections/:id` | recent exact session | Revoke own provider grant and mark connection revoked | 401, 403, 404, 409/503 |

OAuth endpoints preserve standards error shapes. Lumimail JSON routes use existing response
envelopes. MCP tool failures expose bounded, non-sensitive messages and never raw D1/provider errors.

## 6. Tool Contract

- Read tools accept bounded pagination and optional mailbox filters. Search has bounded query length,
  result count, and attachment bytes; it cannot search another tenant by identifier.
- `mail.read` permits only list/search/get operations.
- `mail.actions` is an explicit superset and permits existing reversible state and draft services.
- `send_mail`, `reply`, and `forward` require a client-generated 16–128 character idempotency key.
  Lumimail hashes normalized request input, writes the idempotency row atomically with the outbound
  message/body/job, then enqueues through the existing durable queue. Same key/same hash returns the
  original acceptance; same key/different hash returns a conflict.
- Tool output is the minimum needed for the operation. Attachment retrieval is opt-in, size-bounded,
  and uses the existing access-controlled attachment reader.

## 7. UI/UX

- `/settings/mcp` joins the existing personal Integrations category.
- `McpProfilePicker` defaults to Read only. Mail actions uses explicit explanatory copy and is never
  inferred from the client's requested scopes.
- `OAuthConsentPage` identifies the client and lists concrete allowed/forbidden behavior. Deny and
  expired-request states are first-class. Approval asks for password reconfirmation when needed.
- `ConnectedClientList` shows client name, profile, connected/last-used times, and revoked state.
  Revocation has confirmation, loading, success, and recoverable failure states.
- Mobile is a single-column dialog/page; keyboard focus and error announcements are preserved.

## 8. Current Behavior

The local implementation now exposes the specified OAuth/MCP, consent, connection-management,
read, draft, state, and durable send surfaces. Personal API keys remain independent. The production
and staging Workers have not been promoted because their separate `OAUTH_KV` namespaces could not
be created while Wrangler authentication was unavailable; consequently managed OAuth protocol
evidence is still pending and this feature remains In Progress.

## 9. Error States

| Condition | Result |
|---|---|
| Missing/expired/revoked token, approving session, user, or organization membership | deny without tool execution |
| Wrong resource or audience | OAuth 401/invalid target; never accept origin-only approximation |
| Plain/missing PKCE or invalid redirect | OAuth request rejected |
| Insufficient scope/profile | 403/protocol authorization error |
| Removed/downgraded mailbox membership | not found/forbidden before data access or mutation |
| Cross-organization mailbox/message/attachment ID | same not-found result as an absent ID |
| Duplicate idempotency key with same input | return original message acceptance; no second queue send |
| Duplicate key with different input | conflict; no write or queue send |
| D1/R2/queue/provider failure | bounded unavailable error; existing outbound compensation retained |
| Connection revocation partially fails | fail closed for UI success; retry remains safe and provider state is authoritative |
| Registration or approval rate-limit storage unavailable | fail closed with bounded 503; no client or grant is created |

## 10. Edge Cases

- Multiple concurrent authorization approvals and refreshes do not broaden the originally approved
  scope. Refresh tokens rotate and replayed tokens fail.
- Requested action scope never changes the default picker away from read only.
- The active organization pointer changing invalidates the old organization-bound grant.
- Session expiry, password reset, session deletion, user deletion, or organization removal denies
  the next MCP call. Lumimail currently has no independent banned-user state; user absence and
  membership removal are the applicable fail-closed cases.
- Revocation and tool calls racing are safe: authorization is rechecked before service execution,
  and send still cannot duplicate because D1 idempotency is authoritative.
- Pagination, query text, recipients, subject/body, attachment names/bytes, and provider responses
  never enter security audit events or logs.
- Compatibility DCR is limited per source IP, authorization approval is limited per user, and grant
  enumeration during revocation is page-bounded. Exceeding a bound fails closed without changing
  the D1 connection state.

## 11. Permissions & Threat Model

- The browser session authenticates the human; recent authentication authorizes approval/revocation;
  the OAuth grant authorizes only its explicit profile; mailbox membership authorizes each object.
- OAuth grant properties contain only opaque user, organization, approving-session, connection, and
  profile identifiers. Access tokens/codes/secrets never enter D1, application logs, browser JSON,
  security history, or MCP output.
- The MCP resource is the exact canonical HTTPS URL derived from configured `PUBLIC_APP_URL`; token
  requests and tool calls must bind to it. No token is forwarded to Cloudflare or an email provider.
- Provider client and redirect validation is used both before consent and when completing approval.
  Approval never trusts form-supplied client, redirect, resource, scope, user, org, or session data.
- Tool implementations call shared query/action services or the same mailbox predicates as existing
  routes. A separate role table or cached mailbox allowlist is prohibited.

## 12. Test Plan

| Layer | Coverage |
|---|---|
| Unit | scope/profile rules, resource matching, consent-state binding, registration/approval abuse limits, bounded revocation, tool input/output bounds, content-free audit values, idempotency hashing/conflicts |
| Route/worker | metadata, PKCE/redirect failure, anonymous and stale/revoked session denial, approval/revocation ownership, wrong audience/resource, insufficient scope |
| Tool integration | current mailbox capability checks; foreign org/message/attachment refusal; role downgrade; read vs action tools |
| Outbound integration | concurrent same-key sends persist/enqueue once; changed-input conflict; queue compensation; reply/forward authorization |
| Migration/local D1 | fresh/upgrade parity, indexes/constraints, real cross-tenant and idempotency behavior |
| E2E | read-default consent, action consent, deny, recent-auth flow, connection list/revoke, responsive and keyboard behavior |
| Cloudflare staging | real PKCE client flow, discovery, refresh rotation, token/grant revocation, MCP initialize/tool call, repeated send proof |

Required gates: focused red tests before implementation, `npm run verify`, `npm run e2e`, migrated
local-D1 E2E, Worker build/type generation, then disposable/staging OAuth evidence before production.

## 13. Open Questions / Decisions

- Decision: use the canonical Lumimail origin and `/mcp`, not a second integration origin. — 2026-08-14
- Decision: use the current stateless `createMcpHandler`; deprecated `McpAgent` state is unnecessary
  because D1/Queues own application durability. — 2026-08-14
- Decision: bind every grant to the exact approving browser session and active organization. This
  makes existing session revocation and password-reset session deletion effective for MCP. — 2026-08-14
- Decision: provider KV is authoritative for protocol credentials; D1 is a secret-free lifecycle,
  audit, and durable-idempotency projection. — 2026-08-14
- Decision: dynamically registered clients are validated protocol identities, not trusted apps.
  Explicit human consent remains mandatory and defaults to read only. — 2026-08-14
- Decision: retain DCR only for compatibility, cap it per source IP, reject unverified
  `software_statement` input, cap approvals per user, and bound grant pages during revocation. CIMD
  remains the preferred client discovery mechanism. — 2026-08-14
- Decision: pin `agents@0.20.1`, `@modelcontextprotocol/server@2.0.0`, and
  `@cloudflare/workers-oauth-provider@0.10.3` exactly. Agents declares the MCP server as an exact
  peer, and protocol/security changes must arrive through intentional upgrades. — 2026-08-14

## 14. Bug / Change Log

### 2026-08-14 — Implement and locally verify the OAuth/MCP surface

Type: Feature / Security Fix

Summary:
- Add provider-owned OAuth/PKCE storage and routing, exact dynamic grant validation, read/action
  tools, consent and connection UI, revocation, content-free audit, bounded registration/approval,
  and connection-scoped atomic outbound idempotency.

Reason:
- Complete Layer 4 locally without weakening Lumimail's session, tenant, mailbox, or durable-send
  contracts.

Impact:
- The production Worker is unchanged until separate OAuth KV bindings exist and staging protocol
  evidence passes.

Tests:
- `npm run verify`: 2,201 application tests at 100% statements, branches, functions, and lines;
  21 bridge tests.
- `npm run e2e`: 98 Chromium scenarios, including three OAuth/MCP consent and revocation flows.
- `npm run e2e:local`: 53 migrated-D1 browser scenarios pass.
- Fresh/upgrade migration parity and local migration `0033` pass; OpenNext build and Wrangler
  dry-run bundle pass.

### 2026-08-14 — Specify the separately consented integration surface

Type: Feature / Security Fix

Summary:
- Define OAuth/PKCE, exact-resource validation, explicit read/action consent, session binding,
  revocation, dynamic mailbox checks, bounded tools, content-free audit, and durable send idempotency.

Reason:
- AI clients need delegated access without receiving permanent personal API keys or bypassing
  Lumimail's mailbox authorization and outbound durability contracts.

Impact:
- Specification only in this first change; production behavior remains unchanged until the tested
  implementation and bindings are deployed.

Tests:
- The implementation begins with failing protocol, authorization, isolation, and idempotency tests.
