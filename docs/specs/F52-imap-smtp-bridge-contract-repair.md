# F52 — IMAP/SMTP Bridge Contract Repair

> Status: Implemented locally; production host/client validation pending
> Remediation: R-23
> Supersedes the incomplete API, security, and compatibility claims in F13

## 1. Current behavior

- The separate Node.js bridge calls `/api/auth/me` and `/api/messages*` with an API key, but those routes require a browser session cookie. Documented API-key authentication and IMAP reads therefore cannot work.
- The bridge mixes legacy and canonical response envelopes and converts failed message-list requests into an empty mailbox, hiding authentication and server failures.
- SMTP submits an array of recipients without a mailbox identity. `/api/v1/send` requires one recipient string and authorizes an explicit sender mailbox.
- The documented scope `messages:read` does not exist. Lumimail keys currently use `read` and `send`.
- An API key belongs to a login identity, while a user's login email can intentionally differ from the shared mailbox address assigned to that user.
- IMAP lists messages across all accessible mailboxes rather than binding a client account to one mailbox.
- Sequence numbers are presented as UIDs. They change when ordering changes and violate IMAP's persistent-UID contract.
- The bridge advertises `STARTTLS`, `AUTHENTICATE`, `IDLE`, `ENABLE`, `LITERAL+`, and other capabilities that it does not implement. `EXPUNGE` reports success without changing state and `SEARCH` ignores its criteria.
- Plaintext IMAP starts on all interfaces by default. SMTP can also start without a certificate. The README calls these production-ready paths.
- The bridge package has no automated tests and is not included in repository verification.
- API-key management is personal, but its page currently lives behind the organization-admin layout. A restricted mailbox member cannot create the key required by the bridge through the UI.

## 2. Desired behavior

### Identity and authorization

- The client username is one complete Lumimail mailbox address, not necessarily the API-key owner's login address.
- The password is an active API key owned by that user.
- Authentication succeeds only when the key owner has explicit membership in the named mailbox.
- IMAP requires the key's `read` scope and a mailbox role with read capability.
- SMTP requires the key's `send` scope and a mailbox role with send capability.
- Every list, detail, state-change, and send operation remains constrained to the authenticated mailbox. Supplying another mailbox or message identifier returns not found rather than exposing its existence.
- Personal API-key creation and revocation are reachable by every authenticated user without exposing organization administration.

### HTTP API

- All bridge traffic uses `/api/v1/*` endpoints and the canonical `{ success, data }` / `{ success: false, error }` envelope.
- `GET /api/v1/session` returns the key owner's identity, scopes, and explicitly assigned mailboxes with their roles and capabilities.
- `GET /api/v1/messages` supports validated `mailboxId`, `direction`, `status`, `starred`, `limit`, and `offset` filters and returns a bounded page.
- `GET /api/v1/messages/:id` returns authorized message metadata and stored text/HTML bodies.
- `PATCH /api/v1/messages/:id` accepts a bounded state change (`read` and/or an allowed folder status).
- Every mailbox-backed message has a persisted positive 32-bit IMAP UID. Allocation is atomic, monotonically increasing, never derived from the current list position, and never reused after deletion.
- `POST /api/v1/send` retains its one-recipient MVP contract. The bridge supplies a string recipient plus the authenticated `mailboxId` and address.

### IMAP

- A connection exposes only the authenticated mailbox, mapped to `INBOX`, `Sent`, `Drafts`, `Spam`, `Trash`, and `Starred`.
- The implemented compatibility target is the bounded command set needed for a controlled Thunderbird account: `CAPABILITY`, `LOGIN`, `NAMESPACE`, `LIST`, `LSUB`, `SELECT`, `EXAMINE`, `STATUS`, sequence and `UID` forms of `FETCH`, `STORE`, and `SEARCH`, `NOOP`, `CLOSE`, `EXPUNGE`, and `LOGOUT`.
- Capabilities name only implemented extensions. `STARTTLS`, `IDLE`, `ENABLE`, SASL authentication, and literal-plus are not advertised until implemented.
- `SEARCH` supports `ALL`, `SEEN`, and `UNSEEN`; unsupported criteria return `NO` rather than a misleading all-message result.
- `\Seen` can be added and removed. `\Deleted` plus `EXPUNGE` maps to Lumimail's recoverable Trash state; it does not hard-delete message content.
- Message bodies are emitted as byte-correct MIME literals with header newline injection removed. Attachments remain outside this repair because inbound attachment ingestion is R-24.
- Message-list and API failures return an IMAP `NO`/`BAD` response and never masquerade as an empty mailbox.

### SMTP

- The authenticated mailbox is the only permitted envelope/header sender.
- Exactly one envelope recipient is accepted for this MVP because the Cloudflare sending provider and `/api/v1/send` currently accept one recipient.
- Multiple recipients, sender mismatch, oversized messages, parse failure, API denial, and provider failure produce SMTP errors rather than a false success.
- SMTP uses the parsed text/HTML body, the envelope recipient string, and the authenticated mailbox ID/address.

### Transport and deployment

- Production IMAP is implicit TLS (normally port 993).
- Production SMTP is submission with STARTTLS (normally port 587).
- The bridge fails closed at startup when certificate/key configuration is absent.
- Plaintext IMAP/SMTP is available only with an explicit development opt-in and must bind to loopback.
- The bridge is a separate long-running TCP service. It is not deployed inside the Cloudflare Worker. The Cloudflare app remains its only message-data backend.

## 3. Security and privacy invariants

- API keys are never written to disk, logs, error messages, or response bodies by the bridge.
- The bridge sends credentials and message data only to the configured Lumimail HTTPS origin.
- Production configuration rejects a non-HTTPS Lumimail API URL.
- Mailbox lookup and message access use both the key owner and organization/mailbox membership; account-wide organization membership alone is insufficient.
- A viewer key cannot send, and a responder key cannot use a different sender identity.
- HTTP 401, 403, and 404 results do not reveal another user's mailbox or message.
- Untrusted email header values cannot insert additional MIME or IMAP response lines.
- The TCP service does not provide an open SMTP relay.

## 4. Edge cases and error states

- Usernames and mailbox addresses compare case-insensitively after trimming.
- Revoked, malformed, or scope-incomplete keys fail authentication.
- A key owner with several assigned mailboxes must configure one client account per mailbox address.
- Empty folders return zero messages without generating invalid sequence number zero.
- Invalid pagination/filter values return `400`; limits are capped at 100.
- A message moved between folders retains its UID.
- Existing messages receive stable UIDs during migration/backfill; new messages receive one at creation.
- A failed UID allocation must fail the message write rather than create bridge-invisible mail.
- IMAP `EXAMINE` is read-only and rejects state changes.
- Disconnects and partial SMTP uploads release session state and do not send.
- Certificate/key mismatch, unreadable files, or only one configured TLS path prevents production startup.

## 5. Test plan

### Application unit/integration

- API-key session endpoint: valid identity/mailboxes, role-derived capabilities, missing scopes, revoked/invalid key, and cross-user mailbox exclusion.
- Message list: canonical envelope, all supported filters, validated pagination, mailbox isolation, and persisted UIDs.
- Message detail/state: read/unread and trash changes, invalid payloads, scope denial, and unauthorized-message non-enumeration.
- UID allocator: backfill, monotonic allocation, persistence across folder changes, and no reuse.
- Personal API-key route remains owner-scoped while its page is available to a restricted member.

### Bridge unit/protocol

- API client uses only `/api/v1/*`, parses only canonical envelopes, and propagates errors.
- Authentication binds the requested mailbox and required scope/capability.
- IMAP capability, login, folder, UID fetch/store/search, read/unread, trash/expunge, byte-length, and unsupported-command responses.
- SMTP valid send, one-recipient enforcement, sender binding, scope denial, oversized input, parse/API failure, and session cleanup.
- TLS configuration starts only the documented listeners and plaintext development mode binds loopback.

### Browser

- A restricted member can open personal API-key management, create a one-time key, and revoke it without gaining organization-administration navigation.

### Controlled client

- Configure Thunderbird against a TLS bridge using a restricted user's key and one shared mailbox address.
- Authenticate, list folders, fetch a received message, toggle read/unread, move it to Trash, and send one controlled outbound message.
- Confirm that another mailbox with known mail does not appear and cannot be fetched or used as a sender.

### Verification

- `npm run verify`
- bridge package tests through the root verification command
- `npm run e2e`
- `npx opennextjs-cloudflare build`
- bridge container build and startup/configuration checks

## 6. Decisions

- Decision 2026-07-23: bind one client account to one mailbox address. This matches Lumimail's explicit mailbox ACL model and avoids exposing every assigned mailbox through one synthetic IMAP namespace.
- Decision 2026-07-23: retain the existing scope names `read` and `send`; repair documentation and callers instead of adding an incompatible alias.
- Decision 2026-07-23: keep the one-recipient sending contract for this repair. Multi-recipient provider delivery requires a separate provider/API contract.
- Decision 2026-07-23: map IMAP deletion to recoverable Trash rather than hard deletion.
- Decision 2026-07-23: require persisted UIDs even for the MVP. Sequence-position UIDs can silently corrupt client synchronization.
- Decision 2026-07-23: do not claim STARTTLS for the custom IMAP server. Production IMAP uses implicit TLS until STARTTLS is actually implemented.
- Decision 2026-07-23: personal API keys belong in authenticated user settings, not organization administration.
- Decision 2026-07-23: hosting and certificate provisioning are operational steps after the local/API contract passes; they do not weaken the fail-closed production defaults.

## 7. Open questions

- Choose the long-running bridge host after implementation validation. A Workers subscription runs the HTTP application but does not itself host this raw TCP Node.js service.
- Choose the production bridge hostname(s) and certificate source before deployment.

## 8. Bug / change log draft

### 2026-07-23 — Repair the external mail-client bridge

Type: Authentication / Protocol correctness / Security

Summary:

- Replace session-only bridge calls with a mailbox-scoped API-key contract, add persistent IMAP UIDs and truthful protocol behavior, bind SMTP to the authorized mailbox, require secure transport, expose personal key management, and add automated bridge coverage.

Reason:

- The shipped bridge could not authenticate/read as documented, submitted incompatible send payloads, exposed mailbox-scope ambiguity, and advertised unsafe or unimplemented behavior.

Impact:

- A controlled standard mail client can use one explicitly assigned Lumimail mailbox without gaining access to any other mailbox, while failures and unsupported features are reported honestly.

## 9. Implementation and verification log

### 2026-07-23 — Local implementation

- Added the canonical API-key session contract with explicit mailbox addresses, roles, and read/send capabilities.
- Repaired the API-key message list contract with validation, mailbox/direction/status/starred filters, bounded pagination, canonical envelopes, and persistent `UIDNEXT`.
- Added mailbox-bound API-key message detail and state routes for body fetch, read/unread, and recoverable Trash changes.
- Added migration `0011`, which backfills persistent positive IMAP UIDs, creates an atomic global allocator, and assigns a non-reused UID to every new message through a database trigger.
- Replaced the bridge's session-only HTTP calls with `/api/v1/*` calls and made API failures propagate instead of appearing as empty folders.
- Bound one bridge login to one explicitly assigned mailbox address. IMAP requires `read`; SMTP requires `send` plus responder/manager mailbox capability.
- Added paged folder synchronization, sparse UID range matching, sequence and UID fetch/store/search, stable UID metadata, envelope/header/body literals, read/unread state, and recoverable delete/expunge behavior.
- Reduced IMAP capabilities to the implemented `IMAP4rev1 NAMESPACE` contract and return explicit errors for unsupported search/flag behavior.
- Bound SMTP envelope/header sender to the authenticated mailbox, limited the MVP to one recipient, and added size/parse/API failure handling.
- Added fail-closed production TLS configuration and loopback-only explicit plaintext development mode.
- Added an authenticated `/settings/api-keys` path and settings entry so a restricted member can create/revoke personal keys without receiving organization-admin access.
- Removed the nonexistent `imap-server` dependency and unused direct `nodemailer` dependency, created a bridge lockfile, and added the bridge test suite to root verification.
- Replaced the aspirational bridge README with the implemented security, capability, client, and deployment contract.
- `npm run verify` passed with 135 application test files, 1,110 tests, 100% statements/branches/functions/lines, 16 bridge tests, and 36 pre-existing lint warnings with zero errors.
- The focused Chromium personal-key scenario passed in 3.2 seconds. The Playwright command then remained open until timeout because the known Wrangler remote-proxy helper could not initialize/stop cleanly in the non-interactive sandbox.
- The escalated OpenNext Cloudflare production build passed and generated `.open-next/worker.js`.
- The executable fresh-D1 migration contract passed with migration `0011`.
- Docker image construction was not verified because Docker is not installed in the current workspace.
- Production D1 migration, Worker deployment, bridge hosting, TLS, and controlled Thunderbird validation remain pending. F52 and R-23 must not be marked shipped until those steps pass.
