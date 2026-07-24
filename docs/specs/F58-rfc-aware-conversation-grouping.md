# F58 — RFC-Aware Conversation Grouping

> Status: `In Progress`
> Owner area: MIME parsing, inbound Queue consumer, compose/reply state,
> drafts, outbound snapshots/providers, message thread API and detail UI

## 1. Problem & User Job

Lumimail exposes a thread API and conversation UI, but received messages use
their own `Message-ID` as `threadId`, outbound messages do not normally receive
a thread, and the compose page uses `inReplyTo` only to quote visible text.
Replies therefore send without `In-Reply-To` or `References` and ordinary
multi-message conversations render as unrelated messages.

**User job:** when I reply from a permitted mailbox, Lumimail and external mail
clients keep the reply chain together without merging messages from another
mailbox or an unrelated conversation.

## 2. User Stories & Acceptance Criteria

- Given an inbound root message and RFC replies with `In-Reply-To` and
  `References`, all messages delivered to the same mailbox receive one internal
  thread ID and render chronologically in the conversation view.
- Given the same RFC message delivered to two mailboxes, each mailbox receives
  an independent internal thread; a user with access to both cannot see copies
  mixed together.
- Given a reply composed from a message, the server—not the browser—loads and
  authorizes the source, inherits its thread, and sends bounded
  `In-Reply-To`/`References` headers.
- Given a reply draft, closing and reopening the draft preserves its authorized
  reply source so sending later retains the thread contract.
- Given an unrelated or unauthorized source ID, send and draft persistence fail
  without exposing whether the source exists.
- Given sanitized HTML plus a plain-text alternative containing quoted-history
  markers, the sanitized HTML remains the primary rendering and Lumimail does
  not append a duplicate plain-text quotation block.

## 3. Scope Boundaries

**In scope:**

- Parse and normalize `Message-ID`, `In-Reply-To`, and `References`.
- Persist RFC identity/reply metadata on messages.
- Resolve a mailbox-scoped internal thread from known ancestors, with a
  deterministic mailbox/root fallback for out-of-order arrivals.
- Carry an internal `replyToMessageId` through compose, autosaved drafts, browser
  send, API-key send, durable Queue snapshots, and both outbound providers.
- Send only server-derived `In-Reply-To` and `References` custom headers.
- Preserve existing thread authorization and chronological rendering.
- Prefer sanitized HTML when a text alternative contains quoted history.

**Out of scope:**

- Subject-only threading for mail without RFC identity headers.
- Retrospective backfill or rethreading of historical messages.
- Collapsing folder-list rows into one row per thread.
- Editing participants, `Cc`/`Bcc`, or multi-recipient thread semantics.
- Cross-mailbox or cross-organization conversations.
- Reconstructing HTML quote boundaries whose identifying attributes were
  removed by the existing ingestion sanitizer.
- Preserving source HTML in a newly authored reply body; production validation
  exposed the plain-text quote flattening tracked by
  [F59](./F59-html-preserving-replies.md).

## 4. Data Model

Migration `0015_add_rfc_threading.sql` extends `messages`.

| Column | Purpose |
|---|---|
| `rfc_message_id` | normalized RFC `Message-ID` when known |
| `in_reply_to` | normalized RFC parent identity |
| `references_header` | normalized, bounded ancestor chain |
| `reply_source_message_id` | internal source message used by compose/drafts |

An index on `(mailbox_id, rfc_message_id)` supports ancestor resolution. The
existing `thread_id` stores an opaque Lumimail thread ID, never raw sender
header content. Existing rows remain unchanged; there is no speculative
historical backfill.

`reply_source_message_id` is intentionally not a database foreign key. Access
is checked at every draft/send write, and deletion of a historical source must
not cascade into or delete a draft/sent message.

## 5. RFC Header Contract

### Normalization

- Accept only angle-bracket message-ID tokens with no control characters.
- A token is at most 998 characters.
- Deduplicate tokens while preserving order.
- Store at most 100 reference entries and at most 2,048 UTF-8 bytes, matching
  the stricter outbound provider boundary.
- When trimming is required, preserve the root token and the newest ancestors
  that fit.
- Empty, malformed, or overlong standalone IDs become `null`; raw header text
  is never stored or logged.

### Internal thread resolution

For each mailbox delivery:

1. Look for a stored ancestor in this mailbox using `In-Reply-To`, then
   `References` from newest to oldest, matching `rfc_message_id` or a
   provider-returned RFC ID.
2. If found, inherit that message's `thread_id`.
3. Otherwise choose the root token: first `References`, else `In-Reply-To`,
   else `Message-ID`.
4. Derive an opaque deterministic ID from `mailboxId + root token`.
5. If no valid token exists, generate a new opaque thread ID.

Including `mailboxId` prevents identical RFC chains delivered to multiple
mailboxes from sharing an internal conversation.

### Outbound reply headers

The client supplies only `replyToMessageId`, an internal Lumimail ID. The server
requires read access to the source and send access to the selected same mailbox.
It derives:

- `In-Reply-To`: source `rfc_message_id`, or a valid legacy/provider RFC ID.
- `References`: normalized source references followed by the source RFC ID.
- `thread_id`: source thread ID, or a new opaque ID if historical data lacks it.

The Queue snapshot carries the two safe header values. Cloudflare and Resend
receive them through their documented `headers` object. Cloudflare controls and
generates outbound `Message-ID`; Lumimail stores a provider result as
`rfc_message_id` only when it is itself a valid RFC token.

## 6. API & Draft Contract

`POST /api/send` and `POST /api/v1/send` add one optional field:

```json
{ "replyToMessageId": "msg_..." }
```

Raw `inReplyTo`, `references`, `threadId`, and arbitrary custom headers are not
accepted. A missing/inaccessible/cross-mailbox source returns non-enumerating
HTTP 404.

Draft create/update/read adds the same internal field. A reply draft may change
body, subject, or recipient, but moving it to another mailbox requires the
source to be authorized in that mailbox; otherwise the write fails.

## 7. UI/UX

- Reply continues opening compose with the existing source message ID.
- Compose stores that ID in state, autosaves it, restores it with a draft, and
  submits it with the message.
- Forwarding does not set reply metadata and does not join the source thread.
- Thread detail remains chronological and expands the current message.
- When HTML and text alternatives both exist, sanitized HTML is primary. If the
  text alternative exposes quoted history, Lumimail does not render that parsed
  quotation below the HTML and duplicate the conversation.

## 8. Error States

| Condition | Behavior |
|---|---|
| Malformed inbound RFC headers | store message in a new opaque thread |
| Known parent in another mailbox | do not inherit it; use mailbox fallback |
| Unauthorized reply source | HTTP 404, no draft/message/job |
| Reply source and sender mailbox differ | HTTP 404, no provider call |
| Source lacks RFC ID | preserve internal grouping; omit outbound RFC headers |
| Provider rejects headers | normal durable delivery retry/failure policy |
| Excessive References | normalize to bounded safe chain |
| Out-of-order child | deterministic mailbox/root fallback groups later family members |

## 9. Edge Cases

- Duplicate reference tokens are emitted once.
- `In-Reply-To` containing multiple tokens uses the first valid token.
- Sibling replies with the same root group together.
- Same subject without RFC linkage does not group.
- Reused hostile `Message-ID` can affect only the same mailbox.
- Historical threads retain their existing ID when used as a reply source.
- Draft deletion does not alter the source; source deletion leaves the draft
  readable but prevents a later threaded send until the reply context is
  removed by composing a new message.

## 10. Permissions & Security

- Ancestor lookup is always constrained by `mailbox_id`.
- Reply-source reads use mailbox `read`; sending/draft writes require mailbox
  `send`, and source/sender mailbox IDs must match.
- API-key sends use the same source and mailbox checks.
- Header values are server-derived, bounded, CR/LF-free, and limited to the two
  allowlisted threading headers.
- Thread API reads continue through `messageAccessCondition`; opaque thread IDs
  are not authorization credentials.
- No additional message data leaves the configured outbound provider.

## 11. Test Plan

| Layer | Coverage |
|---|---|
| Unit `threading.test.ts` | token normalization, bounds, deterministic isolation, reply-chain building |
| Parser | RFC field extraction and malformed fallback |
| Inbound | known parent, out-of-order fallback, sibling, multi-mailbox isolation |
| Send/Queue | same-mailbox authorization, snapshots, persistence, provider-result identity |
| Providers | Cloudflare and Resend custom header mapping |
| Draft API/UI | reply context create/update/restore/send |
| Thread API | chronological authorized results and non-cross-mailbox IDs |
| Message display | HTML remains primary without duplicate quote block |
| Migration | executable columns/index and complete schema parity |
| Browser | reply request contains source ID; a three-message chain renders as one thread |

Run `npm run verify`, the relevant Chromium scenarios, the production Next and
OpenNext builds, and a Wrangler dry run before deployment.

Production validation uses a controlled inbound message, a Lumimail reply, and
an external reply. Confirm provider headers, three stored messages sharing one
mailbox-scoped thread, chronological UI rendering, and an unrelated same-subject
message remaining separate.

## 12. Decisions

- Use opaque mailbox-scoped internal IDs rather than raw RFC IDs as `thread_id`.
  — 2026-07-24
- Accept only an internal reply source from clients; derive all RFC headers on
  the server. — 2026-07-24
- Preserve reply context in drafts because autosave/reopen must not silently
  turn a reply into a new conversation. — 2026-07-24
- Do not use subject fallback because false merges are more damaging than an
  ungrouped malformed message. — 2026-07-24
- Prefer the sanitized HTML alternative and suppress duplicate parsed
  plain-text history when both are present. — 2026-07-24

## 13. Bug / Change Log

### 2026-07-24 — Specify RFC-aware mailbox conversations

Type: `Feature | Correctness | Security`

Summary:

- Defined bounded RFC identity parsing, mailbox-isolated thread resolution,
  server-authorized reply headers, durable draft/send propagation, and
  conversation rendering behavior.

Reason:

- Existing thread IDs are per-message and reply metadata never reaches the
  delivery provider, so ordinary conversations cannot group reliably.

Tests:

- Planned unit, API, migration, provider, browser, build, and controlled
  production reply-chain validation.

### 2026-07-24 — Implement and locally verify RFC-aware mailbox conversations

Type: `Feature | Correctness | Security`

Summary:

- Added normalized and bounded RFC identity parsing, mailbox-scoped opaque
  thread resolution, same-mailbox reply-source authorization, durable reply
  headers, reply-aware drafts/compose, both provider mappings, and single-source
  HTML reply rendering.

Verification:

- `npm run verify`: 1,253 application tests at 100% statement, branch,
  function, and line coverage plus all 16 IMAP bridge tests.
- The complete 40-scenario Chromium run reached 39 passes before the existing
  Cloudflare dev-runtime teardown timeout; the unrelated shared-draft
  focus-refresh scenario failed during that run.
- The focused R-25 Chromium contract passed, proving compose submits only
  `replyToMessageId` and does not expose raw RFC headers or a client-selected
  thread ID. Playwright again timed out while stopping the existing remote
  Cloudflare development proxy after the successful test.
- The executable migration suite applies `0015_add_rfc_threading.sql` and
  confirms the resulting D1 schema matches the Drizzle contract.

Not yet verified:

- A controlled production inbound → Lumimail reply → external reply chain
  grouped all three messages correctly. It also exposed that Lumimail's
  outgoing reply flattened the quoted HTML source into plain text. The
  server-derived multipart repair is tracked in
  [F59](./F59-html-preserving-replies.md) and requires a fresh production chain
  after deployment. R-25 and F18 therefore remain in progress rather than
  shipped.

Deployment:

- The OpenNext production build and Wrangler dry run passed. The build used
  local development binding proxies because this non-interactive shell has no
  API-token environment variable; the committed production configuration was
  restored before the dry run and deployment.
- Migration `0015_add_rfc_threading.sql` applied successfully to production D1,
  and Wrangler reports no pending migrations.
- Worker `c6e78f82-d416-438f-962c-32acb29299ac` is deployed to
  `mail.henriksen.dev`; the root returns HTTP 200 and unauthenticated
  `/api/auth/me` fails closed with HTTP 401.
