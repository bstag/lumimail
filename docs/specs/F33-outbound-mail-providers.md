# F33 — Pluggable Outbound Mail Providers (Cloudflare, Resend)

> Status: Shipped
> Owner area: `src/lib/email/providers/`, `src/lib/email/send.ts`

## 1. Problem & User Job

Outbound sending was hard-wired to the Cloudflare `send_email` binding
(`env.EMAIL`). That binding only delivers to **destination addresses verified
in the Cloudflare account**, which makes it unsuitable for general
person-to-person or agent-to-anyone mail — you cannot reply to an arbitrary
sender. Operators who want to run real mailboxes (including many low-volume
"AI agent" mailboxes billed by volume rather than per seat) need an outbound
path that delivers to arbitrary recipients on a verified sending domain.

As an operator, I can choose the outbound provider via configuration so I can
send to any recipient (via Resend) while keeping Cloudflare as the default for
existing deployments.

## 2. User Stories & Acceptance Criteria

- As an operator, I can set `MAIL_PROVIDER=resend` and have all outbound mail
  delivered through Resend to arbitrary recipients.
  - Given `MAIL_PROVIDER=resend` and a valid `RESEND_API_KEY`, when a user
    sends mail, then Lumimail POSTs to the Resend API and stores the returned
    id as `messages.providerMessageId`.
- As an operator who changes nothing, outbound continues to use Cloudflare.
  - Given `MAIL_PROVIDER` is unset, when a user sends mail, then the Cloudflare
    `env.EMAIL` binding is used exactly as before.
- As an operator, a misconfiguration fails fast with a clear error.
  - Given `MAIL_PROVIDER=resend` without `RESEND_API_KEY`, sending throws
    `RESEND_API_KEY is required when MAIL_PROVIDER=resend`.
  - Given an unknown `MAIL_PROVIDER`, sending throws `Unknown MAIL_PROVIDER: <value>`.

## 3. Scope Boundaries

**In scope:**
- Outbound provider abstraction (`OutboundProvider`) with `cloudflare` and
  `resend` implementations.
- `MAIL_PROVIDER` selection (case/whitespace-insensitive), default `cloudflare`.
- Resend send via HTTP API, with `RESEND_BASE_URL` override.
- Wiring `sendEmail()` to the selected provider.

**Out of scope:**
- Inbound mail (still Cloudflare Email Routing → `worker.ts` `email()` handler).
- Attachments, `cc`/`bcc`, reply-threading headers (`In-Reply-To`/`References`).
  The abstraction carries `from/to/subject/html/text` only, matching the
  current `sendEmail()` payload. Future providers/headers extend `OutboundMessage`.
- A UI/admin toggle. Selection is env-only for now.
- Additional providers (SES, Postmark, SMTP).

## 4. Data Model

No schema changes. `messages.providerMessageId` continues to store the
provider-assigned id (Cloudflare `messageId` or Resend `id`).

| Table | Columns touched | Notes |
|-------|------------------|-------|
| `messages` | `providerMessageId`, `status` | set on send success/failure (unchanged) |

## 5. API Contract

No HTTP contract change. `/api/send` and `/api/v1/send` still return
`{ messageId, providerMessageId }`. Behavior is selected by env:

| Env var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `MAIL_PROVIDER` | no | `cloudflare` | `cloudflare` or `resend` |
| `RESEND_API_KEY` | when `resend` | — | Resend API key (secret) |
| `RESEND_BASE_URL` | no | `https://api.resend.com` | endpoint override (proxy/tests) |

## 6. UI/UX

None. Configuration only.

## 7. Test Plan

| Layer | File | What it covers |
|-------|------|-----------------|
| Unit | `tests/unit/lib/email/providers/cloudflare.test.ts` | maps message → `env.EMAIL.send`, normalizes result |
| Unit | `tests/unit/lib/email/providers/resend.test.ts` | auth header, body shape, base-url override, non-2xx error, missing id |
| Unit | `tests/unit/lib/email/providers/index.test.ts` | default/explicit/case-insensitive selection, unknown throws |

Coverage target: 100% for the new files (added to `vitest.config.ts` include list).

## 8. Current Behavior

Before this change, `sendEmail()` called `env.EMAIL.send(...)` directly and read
`response.messageId`. After: it calls `selectOutboundProvider(env).send(...)`
and reads `response.providerMessageId`. With `MAIL_PROVIDER` unset the runtime
behavior is identical to before.

## 9. Error States

| Condition | User-visible message | HTTP status | Logged? |
|-----------|----------------------|--------------|---------|
| `MAIL_PROVIDER=resend` without key | "Send failed" (500) | 500 | job + message marked `failed` |
| Unknown `MAIL_PROVIDER` | "Send failed" (500) | 500 | job + message marked `failed` |
| Resend non-2xx | "Send failed" (500) | 500 | job + message marked `failed`, `message.failed` webhook |
| Resend response without id | "Send failed" (500) | 500 | job + message marked `failed`, `message.failed` webhook |

Errors propagate through the existing `try/catch` in `sendEmail()`, which marks
the message/job `failed` and dispatches the `message.failed` webhook.

## 10. Edge Cases

- `MAIL_PROVIDER` with surrounding whitespace / mixed case → normalized.
- `RESEND_BASE_URL` with trailing slashes → stripped before appending `/emails`.
- `html` and `text` both omitted → forwarded as-is; the provider/API decides
  (Resend rejects with 422, surfaced as a send failure). Matches prior
  Cloudflare behavior of delegating empty-body handling to the provider.
- Sender authorization is still enforced upstream by `validateSenderDomain()`;
  providers do not re-check it.

## 11. Permissions & Security

- No change to who can send (`guardUser` / API key `send` scope).
- `RESEND_API_KEY` is a secret, read from `env`, never returned in responses.
- Cross-tenant isolation is unaffected — provider selection is account-global
  and the message/sender checks in `sendEmail()` are unchanged.

## 12. Open Questions / Decisions

- Provider selection scope → **Decision:** account-global via env var, not
  per-mailbox, to keep this change minimal and reversible. Per-mailbox routing
  can extend `OutboundMessage`/selection later. (2026-06-18)
- Reply threading headers → **Decision:** out of scope here; `sendEmail()` does
  not yet populate `In-Reply-To`/`References`, so adding them to the provider
  contract now would be dead surface. Tracked as future work. (2026-06-18)

## 13. Bug / Change Log

### 2026-06-18 — Pluggable outbound providers with Resend support

Type: Feature

Summary:
- Added `src/lib/email/providers/` (`types.ts`, `cloudflare.ts`, `resend.ts`,
  `index.ts`) with an `OutboundProvider` abstraction and `selectOutboundProvider(env)`.
- `sendEmail()` now sends via the selected provider instead of calling
  `env.EMAIL.send()` directly.
- Added `MAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_BASE_URL` to `env.d.ts` and
  `.dev.vars.example`; documented in `wrangler.jsonc.example` and `README`.

Reason:
- The Cloudflare binding only delivers to verified destination addresses, which
  blocks real-world outbound. Resend delivers to arbitrary recipients on a
  verified domain.

Impact:
- Default behavior unchanged (`MAIL_PROVIDER` defaults to `cloudflare`).
- Opt-in Resend outbound via configuration; no schema or API contract changes.

Tests:
- New unit tests for all three runtime provider modules; 100% coverage. Full
  `npm run verify` green.

Notes:
- Inbound mail is unchanged (Cloudflare Email Routing). Attachments, cc/bcc, and
  reply-threading headers remain out of scope.
