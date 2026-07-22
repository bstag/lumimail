# Lumimail feature validation against the codebase

Date: 2026-07-22

This audit validates the F01–F35 registry against executable code, schema,
Cloudflare configuration, automated tests, and available user-interface paths.
It does not treat a route name, schema table, or passing mocked test as proof of
an end-to-end production feature.

## Evidence standard

- **Confirmed**: the bounded behavior named below has an implementation path and relevant automated coverage.
- **Partial**: useful pieces exist, but an end-to-end or safety-critical part is absent.
- **In progress**: supporting code exists, but a user cannot complete the advertised workflow.
- **Blocked**: a known defect makes the advertised workflow nonfunctional or unsafe.
- **Out of scope**: deliberately absent.

The validation levels are:

- **Code**: static inspection of handlers, services, schema, components, and Worker bindings.
- **Unit/API**: Vitest coverage of logic or route behavior, generally with mocked Cloudflare bindings.
- **Browser**: Playwright coverage. Most current browser tests intercept API requests and therefore do not prove D1, R2, Queue, Email Routing, or provider behavior.
- **Production**: traced behavior against deployed infrastructure. No new production mail was sent during this audit.

## Validation results

| ID | Validated result | Concrete evidence | Material limitation |
|----|------------------|-------------------|---------------------|
| F01 | Confirmed for registration, login, cookie sessions, logout, and authenticated password change | Auth routes, `src/lib/auth/`, user/session schema, route tests | Invitation identity belongs to F12; password recovery belongs to F21. Session lookup scans all unexpired sessions and bcrypt-compares each hash. |
| F02 | Partial | Domain routes call `src/lib/domains/provision.ts`; Cloudflare API integration and tests exist | Apex domains are deliberately recorded with `sendingEnabled=false`; production outbound readiness is not automatically established. |
| F03 | Partial | Mailbox CRUD routes and schema exist; organization filtering is implemented | All organization members can list, create, edit, and delete organization mailboxes because these routes use `guardUser`, not an admin or mailbox permission guard. |
| F04 | Confirmed for the web folder views and status-based lists | Folder pages, message query/count/status routes, and route tests | These are Lumimail status views, not independently synchronized IMAP folders. |
| F05 | Partial | Plain-text compose, autosaved drafts, synchronous provider send, and post-send upload UI exist | `ComposeEditor`/Tiptap code is unused. Files upload only after provider delivery and are not attached to the sent email. |
| F06 | Partial | API-key creation, hashing, bearer authentication, read/send scopes, and tests exist | There is no API/UI path to revoke or delete a key. |
| F07 | Partial | Internal routing supports exact address, local part, and `*`; unit tests cover those decisions | Creating a rule does not create a corresponding Cloudflare Email Routing rule. Cloudflare provisioning only creates literal mailbox routes, so an app-level catch-all does not receive arbitrary addresses end to end. The API also accepts patterns the engine never matches, such as `*@domain`. |
| F08 | Confirmed as basic signed, one-attempt webhooks | `src/lib/email/webhooks.ts`, webhook CRUD routes, HMAC and route tests | Delivery is synchronous, has no retry worker, and sends selected metadata to the user-configured external URL. |
| F09 | Confirmed for profile/current-mailbox settings shown in the UI | Settings page/components, profile route, and tests | Theme selection is not part of this feature and remains absent. |
| F10 | Confirmed as development-only seed data | Production guard in `/api/seed`, seed services, and tests | It is correctly unavailable when `NODE_ENV=production`. |
| F11 | Out of scope | No implementation is registered | — |
| F12 | In progress | Organizations, roles, invite records, member UI, and membership routes exist | No mailbox ACL model exists. Invitations are not emailed, the token is returned to the administrator, and registration does not bind the new account to the invited email address. |
| F13 | Blocked | A separate Node IMAP/SMTP bridge exists under `imap-bridge/` | The bridge sends API keys to session-cookie endpoints (`/api/auth/me` and `/api/messages`), so authentication/message access cannot work as documented. SMTP also produces a recipient array while the send API expects a string. No bridge tests or deployment evidence exist. |
| F14 | Confirmed | Starred column, toggle route, starred view, query filter, and tests exist | — |
| F15 | Confirmed | Label CRUD, message-label routes, list filtering, UI, and tests exist | — |
| F16 | Partial | Internal alias resolution and alias CRUD exist | Alias creation does not provision a Cloudflare literal route, and automatic external forwarding only logs the decision. It therefore depends on separate/manual Cloudflare routing to reach the Worker. |
| F17 | Partial | Authenticated upload/download metadata and R2 storage paths exist | Inbound MIME attachments are not parsed or inserted. Outbound uploads occur after send and are not transmitted to recipients. |
| F18 | Partial | Thread query and expandable conversation UI exist | Inbound `threadId` is set to each message's own Message-ID; References/In-Reply-To are not parsed, and outbound messages do not set a thread ID. Normal conversations will not group reliably. |
| F19 | Confirmed as basic metadata/snippet search | User-scoped subject/from/to/snippet queries and tests exist | It does not search full bodies, use full-text indexing, or paginate the dedicated search route beyond 50 rows. |
| F20 | Confirmed | Inbound and outbound paths upsert user-scoped contacts; service tests exist | Outbound contacts are recorded before provider success. |
| F21 | Confirmed | F43, public recovery pages, token/delivery helpers, API and browser tests, and controlled production reset/login | No implementation gap remains in the documented F43 scope. |
| F22 | Confirmed for list/create contacts UI | Contacts page, API, and tests exist | No explicit contact delete UI/API is present. |
| F23 | Confirmed | Message list accepts `labelId`; UI label chips and route tests exist | — |
| F24 | Confirmed as basic inbound filters | CRUD UI/routes and inbound action execution are tested | `hasWords` checks subject/from only, not the message body; label ownership is not validated when a filter is created. |
| F25 | Partial | Vacation settings and best-effort automatic reply are implemented and tested | There is no Auto-Submitted/header suppression, per-sender frequency limit, or durable retry/audit behavior, so responder loops and repeated replies are possible. |
| F26 | Confirmed as text-based reply/forward composition | Message actions prefill compose routes and quote the source text | It does not preserve a full MIME conversation or original attachments. |
| F27 | Partial | The message view can list attachment rows | Received-email attachments never create those rows, so this does not work for normal inbound attachments. |
| F28 | Confirmed | Authenticated password-change form, route, session invalidation behavior, and tests exist | — |
| F29 | Confirmed | User-scoped bulk mutations and paginated message lists/counts are implemented and tested | Counts load all matching rows and aggregate in application code rather than SQL. |
| F30 | In progress | Routing logic can expand pre-existing `group_members` rows | No route or UI creates/manages group members, alias creation never sets up Cloudflare delivery, and external targets are only logged. |
| F31 | Partial | Authenticated inline R2 response supports viewable content types | It only applies to attachment records that exist; inbound attachment ingestion is absent. PDF/image rendering safety still depends on browser behavior and content headers. |
| F32 | Confirmed by responsive layout code | Responsive Tailwind layouts are present throughout dashboard/admin views | There is no dedicated mobile-viewport E2E coverage, so this is code-confirmed rather than device-verified. |
| F33 | Confirmed for provider selection and synchronous send | Cloudflare binding and Resend HTTP providers, selection logic, route/service tests, and bindings exist | Cloudflare's binding and Resend have different external-delivery requirements. Outbound queue configuration exists but application send routes do not enqueue. Neither provider accepts attachments here. |
| F34 | Confirmed | A strict Workers-compatible allowlist sanitizes before storage, both message render paths apply browser defense in depth, and adversarial/fail-closed tests are included in the coverage gate | Verified in production with controlled reply and non-reply HTML messages on Worker `722ae8e3-bb50-4031-9b96-dfc590a20739`. Replies with detected quoted history currently display the plain-text alternative; tracked under R-25. |
| F35 | Confirmed | Manifest, icons, service worker, registration component, unit tests, and browser PWA tests exist | The offline experience is a shell only; mailbox and authenticated routes remain network-only by design. |

## Cloudflare integration validation

The deployed Worker configuration declares D1, R2, inbound and outbound Queues,
an Email Sending binding, static assets, Images, and a self-service binding.
The Worker email handler stores raw mail in R2 and enqueues inbound processing.
The queue consumer distinguishes inbound from outbound-shaped messages.

Important differences between configuration and application use:

- `INBOUND_QUEUE` is actively used by the email handler.
- `OUTBOUND_QUEUE` is configured and has a consumer, but no application producer calls `OUTBOUND_QUEUE.send()`.
- Cloudflare Email Routing rules are provisioned only for literal mailbox addresses.
- The internal catch-all/routing-rule table does not itself cause Cloudflare to deliver unmatched addresses to the Worker.
- R2 stores raw inbound messages and user-uploaded files, but inbound MIME attachment parts are not extracted.

## Data-egress paths found in code

Besides Cloudflare infrastructure, data can leave through these explicit paths:

1. **Resend** when `MAIL_PROVIDER=resend`: sender, recipient, subject, text, and HTML are posted to the configured Resend endpoint.
2. **User-configured webhooks**: event type and selected metadata are POSTed to each configured URL. Inbound payloads include message ID, sender, recipient, and subject; outbound payloads include message ID, provider ID, and recipient; failures include the error string.
3. **External forwarding** is represented in configuration but is not actually transmitted by the current implementation.

Normal Cloudflare API calls also send zone/domain and routing configuration to the
Cloudflare account API. No analytics, advertising, AI, telemetry, or unrelated
third-party export path was found in the inspected application code.

## Automated verification result

`npm run verify` passed on 2026-07-22:

- TypeScript typecheck: passed.
- ESLint: passed with 43 warnings and no errors.
- Vitest: 110 files and 870 tests passed.
- Reported coverage: 100% for the configured logic/route globs.

That percentage excludes React pages/components, `src/lib/email/sanitize.ts`, the
IMAP bridge, and any real Cloudflare/provider execution. The Playwright suite has
only landing, PWA, locale, and mocked API-contract coverage; it does not currently
prove registration, inbound delivery, catch-all, outbound delivery, attachments,
shared mailboxes, or the bridge end to end.

## Result

The repository is a substantial working email application foundation, but the
original feature list overstated several integration-level capabilities. The web
mail core is real. The advertised catch-all, shared/restricted mailbox access,
external forwarding, group administration, normal attachment handling, reliable
threading and IMAP/SMTP client support are not complete today. Password recovery is now complete under F43/R-21.
