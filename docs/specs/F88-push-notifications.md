# F88 — Privacy-Preserving Push Notifications

> Status: Staging Validation
> Owner area: `public/sw.js`, `src/lib/push/`, `/api/push/*`, `/settings/notifications`, `worker.ts`

## 1. Problem & User Job

Lumimail is installable and has an update-safe service worker, but a signed-in user learns about new
mail only after opening or refreshing the app. A user needs an explicit, per-device way to receive a
generic new-mail notification without exposing message content to a browser push service, without
keeping notifications alive after session or mailbox access revocation, and without allowing a push
provider outage to retry or duplicate inbound mail storage.

## 2. User Stories & Acceptance Criteria

- A signed-in user can explicitly enable notifications on the current supported browser, name that
  device, and choose only mailboxes they can currently read. No mailbox is enabled by default.
- Browser notification permission is requested only from the user's enable action. Denied,
  unsupported, non-installed, and unavailable-configuration states are explained without mutation.
- A user can list, rename, change mailbox preferences for, and revoke only their own devices.
  Revocation requires recent authentication and stops server delivery immediately even if browser
  unsubscription fails.
- A persisted, unread inbound inbox message creates a durable notification event without coupling
  push-provider success to inbound storage. Filters run before delivery eligibility is resolved.
- Every delivery rechecks the device's approving session, active organization, current user,
  current read-capable mailbox membership, preference, and current message state.
- The encrypted Web Push payload contains only a fresh opaque delivery ID. The service worker owns
  the generic title/body and never receives sender, recipient, subject, snippet, mailbox name or
  address, attachment data, message ID, user ID, organization ID, session/token, or route.
- Clicking a notification opens an authenticated Lumimail resolver. It returns the message route
  only after rechecking the current session, owning user, active organization, mailbox membership,
  and message access; otherwise it uses the same not-found behavior as an absent delivery.
- Provider `404`/`410` permanently expires the device. `429` and bounded `5xx` failures retry with
  fixed backoff; all retry, expansion, and cleanup work is bounded and idempotent.
- Device lifecycle and preference mutations emit content-free security audit events. Endpoints,
  encryption keys, message data, and push-provider bodies never enter UI responses, audit events,
  evidence output, or logs.

## 3. Scope Boundaries

**In scope:**

- Standards-based Web Push through the existing root-scope service worker and browser Push API.
- Separate staging and production VAPID key pairs supplied as Worker secrets.
- Per-user, per-organization, exact-session devices with user-entered names and an active-device cap.
- Per-device, per-mailbox opt-in preferences that default to empty/off.
- A separate durable push queue plus D1 outbox, paged event expansion, per-device delivery state,
  bounded retry, provider-expiry handling, reconciliation, and retention cleanup.
- Generic notification display, stable replacement tags, click/focus behavior, accessible Settings
  UI, mobile layout, and controlled staging/production evidence.

**Out of scope:**

- Subject, sender, snippet, mailbox address/name, attachment, account, or tenant data in payloads.
- Notification reply/archive/delete actions, arbitrary scheduled reminders, marketing/broadcast
  pushes, administrator-enrolled devices, SMS/mobile-native push, or background message caching.
- A second PWA origin, silent permission prompts, browser fingerprinting/device auto-detection, or
  treating a push subscription as authentication.
- Exactly-once external provider delivery. Lumimail provides durable bounded attempts and a stable
  service-worker notification tag so a retry replaces rather than multiplies the visible notice.
- Automated VAPID private-key rotation in the first release. Rotation is an explicit operator
  migration because existing browser subscriptions are bound to the application server key.

## 4. Architecture and Data Model

Inbound mail and push delivery are deliberately separated:

```text
inbound queue
  -> persist message/body/attachments + push event in one D1 batch
  -> filters/webhooks/vacation continue independently
  -> enqueue opaque event ID best-effort

push queue / scheduled reconciliation
  -> page live eligible devices
  -> create unique (event, device) delivery rows
  -> enqueue opaque delivery IDs
  -> recheck authorization and message state
  -> Web Push provider
```

An enqueue failure leaves the D1 row pending for scheduled reconciliation. A provider failure can
never throw back into inbound processing or cause the email message to be inserted twice.

Migration `0036_add_private_push_notifications.sql` adds:

| Table | Columns | Contract |
|---|---|---|
| `push_devices` | id, user/org/approving-session IDs, name, endpoint, endpoint hash, p256dh, auth, status, timestamps | Endpoint and subscription keys are delivery credentials: stored only in D1, never returned or logged. Partial uniqueness permits only one active row per endpoint hash and one active device per exact session while revoked/expired evidence ages out. |
| `push_device_mailboxes` | device ID, mailbox ID, created timestamp | Unique pair. Rows express explicit opt-in only; absence means off. Delivery still joins live read-capable membership. |
| `push_notification_events` | id, organization/mailbox/message IDs, status, expansion cursor/attempts, due/lease/timestamps | Secret-free durable outbox row inserted atomically with the inbound message. Message is unique. Expansion is paged and resumable. |
| `push_deliveries` | id, event/device IDs, status, attempts, next attempt, provider-safe outcome, timestamps | Unique event/device. Contains no message content. The opaque ID is the complete encrypted push payload and click capability. |
| `security_audit_events` | push device lifecycle actions and `push_device` resource type | Content-free register, rename, preferences, and revoke evidence. High-volume delivery attempts are not security-history events. |

Revoked/expired device credential rows are retained for at most 30 days, then deleted; audit rows
remain under their existing policy. Terminal delivery/outbox rows are retained for 7 days. Scheduled
cleanup and reconciliation each process at most 100 rows per invocation.

## 5. API Contract

All bodies use bounded Zod schemas. Collection responses are secret-free.

| Method | Route | Auth | Contract | Errors |
|---|---|---|---|---|
| GET | `/api/push/config` | session | Availability plus VAPID public key only | 401, bounded unavailable |
| GET | `/api/push/devices` | session | Current user's devices, current marker, status, dates, and accessible mailbox preferences; no endpoint/keys/session ID | 401 |
| POST | `/api/push/devices` | exact session + same origin | Create/update the current browser subscription with a 1–64 character name; starts with zero mailbox preferences | 400, 401, 403, 409, 429, 503 |
| PATCH | `/api/push/devices/:id` | session, own device | Rename one device | 400, 401, 404 |
| PUT | `/api/push/devices/:id/preferences` | session, own device | Replace enabled mailbox IDs only after all resolve to current read-capable memberships in the active organization | 400, 401, 404, 409 |
| DELETE | `/api/push/devices/:id` | recent exact session, own device | Revoke server delivery and audit atomically; browser unsubscribe is client-side best effort | 401, 403, 404 |
| GET | `/notifications/:deliveryId` | session | Resolve an owned delivery to the current authorized `/inbox/:messageId` route or not-found | 401/login, 404 |

Subscription input limits: HTTPS endpoint on port 443, no URL credentials/query fragments beyond
the provider-issued endpoint, maximum 2,048 characters; URL-safe base64 `p256dh` decoding to an
uncompressed P-256 public key and `auth` decoding to 16 bytes; maximum 10 active devices per user and
organization. Only recognized public browser push-service hosts are accepted. Cloudflare's existing
`global_fetch_strictly_public` flag remains mandatory, and there is no arbitrary test-send endpoint.

## 6. Queue and Provider Contract

- Add isolated `PUSH_QUEUE` and `PUSH_DLQ_QUEUE` bindings for local, staging, and production. They
  never alias inbound/outbound resources. Queue payloads contain only versioned opaque event or
  delivery IDs.
- Expansion pages at most 50 live devices and uses unique D1 rows to make queue redelivery safe.
- Delivery rechecks session expiry/existence, organization, device state, mailbox preference,
  read-capable membership, inbound direction, inbox/received status, and unread state immediately
  before provider I/O.
- Web Push uses VAPID, `aes128gcm`, TTL 300 seconds, normal urgency, a bounded request timeout, and a
  32-character content-free topic derived from the event ID. Provider bodies are discarded.
- `404`/`410`: mark device expired and delivery terminal. `429` and `5xx`: retry after 60 then
  300 seconds. Other `4xx`: terminal failure. No delivery exceeds three provider attempts.
- A lease prevents concurrent workers from sending the same delivery. A crash after provider
  acceptance can repeat one request; the stable notification `tag` derived from the delivery ID
  replaces the prior visible notice.
- Missing VAPID configuration fails closed before provider fetch, leaves bounded operational state,
  and never logs a secret. Staging and production use different key pairs.

## 7. Service Worker Contract

- Keep existing install/activate/fetch behavior and its update-friendly cache headers.
- On `push`, accept only JSON with exactly one bounded opaque `notificationId`; malformed/empty
  payloads produce no navigation data and no content leak.
- Display fixed copy: `New mail` and `Open Lumimail to view it.` with Lumimail icons. Use a stable
  tag and store only `/notifications/<opaque-id>` in notification data.
- On `notificationclick`, close the notice, focus an existing same-origin Lumimail client when
  possible, and otherwise open the same-origin resolver URL. Never navigate to payload-supplied URLs.
- On `pushsubscriptionchange`, do not silently grant mailbox preferences. The app surfaces that the
  device must be re-enabled; the old server row naturally stops through expiry/session checks.

## 8. UI/UX

- Add `/settings/notifications` under the account section of the unified Settings shell.
- `NotificationDeviceList` shows name, current-device marker, enabled mailbox count, created/last
  delivered dates, and active/revoked/expired state. It never shows browser endpoint or key data.
- `NotificationPreferences` requests permission only after **Enable notifications** is clicked,
  requires a user-entered device name, then presents only currently readable mailboxes. All are off
  initially; saving zero is valid and sends nothing.
- Rename, preference save, and revoke have explicit loading/success/recoverable error states.
  Revocation uses the existing password reconfirmation contract.
- Unsupported browser, insecure origin, denied/default permission, missing service worker, missing
  push manager, and iOS non-installed states have plain-language guidance without false success.
- Controls remain single-column and fully usable at 390px, keyboard focus is restored after dialogs,
  status changes are announced, and permission state is never inferred from color alone.

## 9. Current Behavior

Lumimail now implements the F88 contract: the root service worker handles only opaque notification
IDs and fixed copy; signed-in users explicitly enroll, name, configure, and recently-auth revoke their
own devices from `/settings/notifications`; and D1 outbox/delivery rows isolate inbound persistence
from bounded provider work. Delivery and click resolution recheck the exact session, organization,
device, preference, mailbox membership, and message state. Isolated staging queues, VAPID secrets,
migration 0036, and the Worker deployment are live. Real staging subscribed-browser delivery,
authorized click, access-revoked click denial, and post-revocation non-delivery remain the promotion
gate before production resources, migration, secrets, and deployment are created.

## 10. Error States

| Condition | Result |
|---|---|
| Browser unsupported/insecure/not installed where required | Explain unavailable state; no permission prompt or API mutation |
| Permission default | User may click enable; only that gesture prompts |
| Permission denied | Explain browser settings recovery; no repeated prompt loop |
| Missing/malformed subscription fields or unrecognized endpoint | 400; nothing stored or fetched |
| Endpoint already owned by another user/session | 409; never reassign credential material |
| Device cap/rate limit reached | 429; existing devices unchanged |
| Missing VAPID secret/configuration | bounded 503/config unavailable; no provider request |
| Foreign device/mailbox/delivery ID | same 404 as absent ID |
| Session, organization, membership, preference, or message state revoked | skip/terminalize before provider I/O; click resolves 404 |
| D1 failure before message batch | inbound retries normally; no partial message/outbox claim |
| Push enqueue failure after committed message | inbound succeeds; pending outbox is reconciled later |
| Provider 404/410 | device expired, credentials stop being used |
| Provider 429/5xx/network timeout | bounded scheduled retry; no inbound retry |
| Permanent provider failure | terminal generic outcome; no response body stored/logged |
| Concurrent expansion/delivery/cleanup | unique constraints + leases yield one logical row and bounded visible deduplication |

## 11. Edge Cases and Security

- A mailbox owner is not the only recipient: every explicitly opted-in current member with `read`
  capability may receive a notice. No organization role substitutes for mailbox membership.
- A later mailbox grant never opts a device in. A downgrade/removal blocks the next delivery and
  click without waiting for preference cleanup.
- Filters that archive, spam, trash, or mark a message read suppress notification delivery.
- Multiple devices receive separate opaque deliveries. Multiple target mailboxes/messages never
  share a delivery capability.
- Account/org switches, logout, password-reset session deletion, session revocation, user deletion,
  device revocation, and subscription expiry all fail closed.
- Endpoint URLs are capability credentials and potential SSRF targets. Input accepts only HTTPS
  port 443 on recognized public Web Push hosts, requests are rate/batch bounded, and Worker public-
  fetch restrictions remain enabled.
- VAPID private key and subject are Worker secrets, never vars, D1 data, API output, logs, builds,
  evidence, or browser storage. The public key is the only VAPID value returned to the browser.
- `p256dh`, `auth`, endpoint, notification payload, and provider response never enter security audit
  history. Device names are user-visible input and also stay out of audit events/logs.
- No request-scoped state lives globally; every promise is awaited or passed through queue/scheduled
  execution. Push work uses bindings rather than Cloudflare REST calls.

## 12. Test Plan

| Layer | Coverage |
|---|---|
| Schema/migration | fresh and upgrade parity; foreign keys; unique endpoint hash, event/message and event/device constraints; no message content columns |
| Validators | device name, endpoint host/port/length, decoded key sizes, device/mailbox list caps, opaque IDs |
| Authorization | exact user/org/session device binding; current read membership; cross-tenant device/mailbox/delivery denial; immediate session/access/device revocation |
| Outbox | message and event atomicity; filter/state suppression; enqueue failure leaves recoverable pending work; no inbound replay from push failure |
| Expansion/delivery | bounded pages, unique rows, leases, eligibility recheck, VAPID configuration, minimal payload, timeout/status classification, retry schedule/cap, expiry and cleanup |
| Service worker | unchanged cache behavior; valid/malformed push payload; fixed copy/tag; same-origin click focus/open; no arbitrary URL navigation |
| Routes | secret-free list/config, create/idempotency/conflict/cap, rename/preferences/revoke recent-auth, resolver positive/negative behavior |
| E2E mocked | explicit permission gesture, unsupported/denied states, zero-default mailbox selection, device list/rename/preferences/revoke, errors, keyboard and 390px layout |
| Migrated local D1 | real cross-user/org/mailbox isolation, session and membership revocation, durable unique outbox/delivery behavior |
| Worker build | generated env types, queue type guards, OpenNext build/dry run, startup profile, no secret in config or assets |
| Staging/production | separate VAPID/queue bindings, real browser subscribe, controlled inbound generic notice, authorized click, access-revoked click denial, device revoke, no subsequent notice |

Required gates: focused failing tests, local migration, `npm run verify`, `npm run e2e`,
`npm run e2e:local`, generated types, OpenNext build and Wrangler dry run, isolated staging provider
evidence, then production migration/bindings/deploy/smoke and one controlled opt-in/revoke proof.

### Verification evidence — 2026-08-14

- `npm run verify`: 2,330 unit/integration tests and 21 IMAP bridge tests passed; all gated logic is
  at 100% statements, branches, functions, and lines. Existing lint warnings remain non-blocking.
- `npm run e2e`: 100 Chromium tests passed, including explicit enrollment, zero-default mailbox
  preferences, rename, recent-auth revocation, and the 390px Settings layout.
- `npm run e2e:local`: migration 0036 applied to persisted local D1 and all 53 real-backend tests
  passed. Fresh and staged-upgrade migration parity also passed.
- OpenNext's production Worker bundle completed after removing a malformed generated `.next/dev`
  cache artifact. Production and staging Wrangler dry runs accepted the isolated push bindings.
- Staging queues `lumimail-push-staging` and `lumimail-push-dlq-staging`, a staging-only VAPID pair,
  migration 0036, and Worker version `94bfec94-98c0-4e22-93ca-301030bdeab3` are deployed. Public
  staging smoke passed 6/6. Authenticated real-browser/provider evidence remains pending.

## 13. Open Questions / Decisions

- Decision: first release is per-device enrollment with mailbox preferences defaulting off. A grant
  never creates an implicit notification subscription. — 2026-08-14
- Decision: bind a device to the exact creating session and active organization, while click
  resolution requires a current valid session for the same user/org rather than trusting the push
  subscription. — 2026-08-14
- Decision: use a separate queue and D1 outbox/delivery projection. Push failure cannot participate
  in or retry inbound message persistence. — 2026-08-14
- Decision: payload is one opaque delivery ID; generic presentation is compiled into the service
  worker. This is stricter than merely omitting the body. — 2026-08-14
- Decision: use the maintained `web-push` package because Cloudflare's current Workers/Agents guide
  demonstrates it on Workers with `nodejs_compat`; pin the chosen version after dependency review.
  Workers Web Crypto supports ECDH, ECDSA, HKDF, and AES-GCM, but Lumimail will not hand-roll RFC
  8291/8292 cryptography. — 2026-08-14
- Decision: treat direct Web Push endpoints as secret capability URLs and restrict them to current
  recognized public browser push services; do not create an arbitrary URL/test-send surface.
  — 2026-08-14
- Decision: device revocation requires recent authentication, matching session/MCP lifecycle
  controls. Preference changes require the current signed-in user plus live mailbox authorization.
  — 2026-08-14
- Decision: VAPID pairs are environment-specific secrets generated outside the Worker. Automated
  private-key rotation and a notification-with-content mode remain out of scope. — 2026-08-14

References:

- Cloudflare Workers push example: <https://developers.cloudflare.com/agents/communication-channels/webhooks/push-notifications/>
- Cloudflare Workers Web Crypto: <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
- W3C Push API: <https://www.w3.org/TR/push-api/>
- RFC 8291 message encryption: <https://www.rfc-editor.org/rfc/rfc8291.html>
- RFC 8292 VAPID: <https://www.rfc-editor.org/rfc/rfc8292.html>

## 14. Bug / Change Log

### 2026-08-14 — Define private push-notification contract

Type: Feature / Security Fix

Summary:
- Specify explicit device enrollment, mailbox opt-in, exact-session and live mailbox authorization,
  content-free payloads, durable queue isolation, bounded delivery/cleanup, lifecycle audit, service
  worker behavior, Settings UI, and managed evidence.

Reason:
- Complete the HQBase-inspired mail-client layer without exposing mail content to push providers or
  weakening Lumimail's tenant, mailbox, session, and inbound durability boundaries.

Impact:
- Specification only. No Push API permission is requested and production behavior is unchanged
  until failing tests, implementation, local/staging proof, secrets, and deployment gates pass.

Tests:
- Begin with failing migration, validator, authorization, outbox, provider, service-worker, route,
  UI, and cross-tenant tests.

### 2026-08-14 — Implement and promote to staging validation

Type: Feature / Security Fix

Summary:
- Added secret-free device APIs and Settings UI, exact-session and live-mailbox authorization,
  durable D1 event/delivery projection, isolated queue processing and cleanup, standards-based Web
  Push delivery, fixed-copy service-worker presentation, and authenticated click resolution.
- Added staging-only queues and VAPID credentials, applied migration 0036, and deployed the verified
  Worker build without creating production push resources.

Reason:
- Close the next HQBase comparison layer while keeping notification metadata private and preserving
  inbound mail durability, tenant isolation, and immediate revocation boundaries.

Impact:
- Staging can enroll real devices and deliver generic notices. Production behavior is unchanged until
  the controlled staging provider proof passes and the separate production promotion is completed.

Tests:
- Full 100% logic coverage, browser E2E, migrated local D1, migration parity, Worker build, both
  environment dry runs, and staging public smoke pass. Real staging browser/provider proof remains.
