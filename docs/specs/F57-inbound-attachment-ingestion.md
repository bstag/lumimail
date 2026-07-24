# F57 — Inbound Attachment Ingestion

> Status: `Shipped`
> Owner area: inbound MIME parsing, inbound Queue consumer, R2 attachment
> storage, D1 message/attachment metadata, message attachment UI and downloads

## 1. Problem & User Job

Lumimail stores every accepted inbound message as raw MIME in R2 and parses its
subject and bodies, but it discards PostalMime's attachment results. The message
view and authenticated download routes therefore work only for files created by
outbound compose; files received through Cloudflare Email Routing never appear.

**User job:** as a mailbox reader, I can see and download files that arrived with
an inbound email, with exact bytes and safe browser behavior, and I am told
truthfully if Lumimail deliberately omitted an abusive attachment set.

## 2. User Stories & Acceptance Criteria

- Given an ordinary inbound message containing supported or arbitrary file
  types, when the Queue consumer completes, then each MIME attachment has a D1
  row and an exact-byte mailbox-owned R2 object.
- Given an inline MIME part, when HTML is sanitized, then it appears in the
  attachment list but is not silently injected into the sanitized body.
- Given a message delivered to multiple mailboxes, then every stored message has
  independent attachment rows and R2 keys; one mailbox never references another
  mailbox's object namespace.
- Given an attachment R2 or D1 persistence failure, then all attachment objects
  written for that mailbox delivery are removed and the Queue invocation fails
  for retry without committing a partial message.
- Given an attachment set outside the bounded ingestion policy, then Lumimail
  stores the message and body, stores no partial subset of files, and displays a
  safe omission warning.
- Given an arbitrary active content type, then the download route never converts
  it into an inline same-origin document merely because a query parameter was
  supplied.

## 3. Scope Boundaries

**In scope:**

- Parse attachment bytes, filename, MIME type, disposition, and content ID from
  PostalMime.
- Persist exact attachment bytes in R2 and existing attachment metadata in D1.
- Add a message-level attachment-ingestion status and bounded reason.
- Atomically commit message, body, and attachment rows after R2 writes.
- Compensate R2 writes when another R2 write or the D1 batch fails.
- Expose the attachment status through the existing attachment-list API.
- Display an omission warning and safely preview only JPEG, PNG, GIF, WebP, and
  PDF.
- Harden all attachment downloads with `nosniff` and an inline allowlist.

**Out of scope:**

- Rewriting sanitized HTML `cid:` references to authenticated URLs.
- Virus/malware scanning, archive extraction, file-type signature detection, or
  content disarm/reconstruction.
- Reprocessing historical raw MIME objects.
- User deletion of individual received attachments.
- Deduplicating bytes shared by group or multi-mailbox delivery.
- Repairing general inbound message idempotency or forwarding.

## 4. Data Model

Migration `0014_add_inbound_attachment_status.sql` extends `messages`.

| Table | Columns touched | Notes |
|---|---|---|
| `messages` | `attachment_status`, `attachment_error` | `none`, `stored`, or `omitted`; safe bounded reason only |
| `message_bodies` | existing body/raw columns | committed in the same D1 batch as message/attachments |
| `attachments` | all existing columns | one row per MIME attachment and per delivered mailbox message |

`attachment_status` defaults to `none` for existing messages. Outbound messages
with files set it to `stored`; new inbound messages set it from parsed ingestion.
`attachment_error` is non-null only for `omitted`.

## 5. Ingestion Contract

### MIME parsing

- PostalMime parses the already-buffered raw object once with
  `attachmentEncoding: "arraybuffer"`.
- Parsed attachment content is normalized to an exact `ArrayBuffer`.
- Filename path components and control characters are removed, the result is
  limited to 255 UTF-16 code units, and an unnamed file becomes `attachment`.
- MIME type is lowercased and trimmed; a missing/invalid value becomes
  `application/octet-stream`.
- Disposition and content ID are parsed for future use but are not added to the
  current D1 schema because the current UI intentionally lists both attachment
  and inline parts.

### Bounded policy

Cloudflare Email Routing rejects inbound messages larger than 25 MiB. Lumimail
adds resource/cost limits within that envelope:

| Limit | Value |
|---|---:|
| MIME attachment count | 50 |
| One decoded attachment | 25 MiB |
| Aggregate decoded attachment bytes | 25 MiB |

If any bound is exceeded, the complete set is omitted. The raw MIME remains in
R2, the message/body are stored with `attachment_status = omitted`, and the UI
shows `Attachments were omitted because this message exceeded Lumimail's safe
ingestion limits.` No filename, byte count, MIME structure, or parser detail is
put in the error field.

### R2 and D1 ordering

For each mailbox delivery:

1. Generate the message and attachment IDs.
2. Write attachment objects sequentially to
   `attachments/{userId}/{messageId}/{attachmentId}` with MIME HTTP metadata.
3. Build message, body, and attachment inserts.
4. Commit all D1 rows in one batch.
5. Run filters, webhooks, and vacation behavior only after durable persistence.

If an R2 write or the D1 batch fails, delete all attachment objects written for
that mailbox delivery and rethrow. Cleanup failures are logged without object
keys, filenames, addresses, content, or provider details.

Multi-mailbox delivery repeats this process with independent message IDs and
object keys. Existing whole-message Queue retry/idempotency behavior is unchanged
and remains a separate reliability concern.

## 6. API Contract

`GET /api/messages/{messageId}/attachments` keeps its authenticated,
mailbox-capability-scoped success envelope and adds:

```json
{
  "success": true,
  "data": {
    "attachmentStatus": "stored",
    "attachmentError": null,
    "attachments": []
  }
}
```

`attachmentError` is a server-selected bounded string or `null`. Cross-tenant and
unauthorized message IDs remain non-enumerating HTTP 404.

`GET /api/attachments/{id}` keeps the existing authenticated download contract:

- Always sets `X-Content-Type-Options: nosniff`.
- Honors `?disposition=inline` only for JPEG, PNG, GIF, WebP, and PDF.
- Every other type remains `attachment`.
- Inline responses add a restrictive Content Security Policy.
- The stored content type, filename, exact `Content-Length`, private cache
  policy, and streaming R2 body remain unchanged.

## 7. UI/UX

- The existing attachment list renders received files without a new page.
- `stored` attachments retain the existing count, download link, image preview,
  and PDF preview.
- `omitted` renders the safe warning even when the attachment array is empty.
- `none` with an empty array renders nothing.
- Image preview uses the same explicit safe-image allowlist as the server rather
  than every `image/*` type.
- The warning and attachment rows remain usable at mobile widths.

## 8. Error States

| Condition | User-visible behavior | Queue behavior | Logged? |
|---|---|---|---|
| No attachments | no attachment section | ack normally | no |
| Policy limit exceeded | omission warning | ack normally | safe warning only |
| PostalMime parse failure | no message committed | retry | safe parser summary |
| R2 attachment write failure | no partial message/objects | retry | safe summary |
| D1 batch failure | written attachment objects removed | retry | existing Queue error |
| Cleanup failure | no additional user detail | original failure retries | generic cleanup error |
| Stored object later missing | authenticated HTTP 404 | n/a | no new behavior |
| Unauthorized attachment/message | non-enumerating HTTP 404 | n/a | no |

## 9. Edge Cases

- Empty files are stored with size zero.
- Duplicate filenames remain separate attachment rows.
- Unnamed files use `attachment`; no user-controlled path becomes an R2 key.
- `Uint8Array` content with a non-zero offset is copied exactly.
- String content is UTF-8 encoded defensively even though array-buffer parsing is
  requested.
- Inline parts, unknown types, archives, and executable filenames are stored for
  explicit download; they are not automatically executed or previewed.
- A non-empty attachment set is never partially omitted due to policy.
- A later mailbox failure can cause the existing Queue retry to redeliver an
  earlier mailbox; F57 does not claim to solve general inbound idempotency.

## 10. Permissions & Security

- Existing mailbox `read` capability controls list and byte access.
- R2 keys contain server IDs, not filenames, content IDs, or sender data.
- Each multi-mailbox copy is namespaced by the owning user and message.
- Attachment bytes, filenames, MIME structures, addresses, raw keys, and parser
  errors are never logged during failure handling.
- Active formats do not receive an inline disposition; `nosniff` prevents MIME
  reinterpretation.
- No attachment data leaves Cloudflare infrastructure through this feature.

## 11. Test Plan

| Layer | File | Coverage |
|---|---|---|
| Unit | `tests/unit/lib/email/parse.test.ts` | exact bytes, metadata normalization, empty/inline/unnamed content |
| Unit | `tests/unit/lib/email/inbound-attachments.test.ts` | limits, normalization, omission policy |
| Unit | `tests/unit/lib/email/inbound.test.ts` | R2/D1 ordering, compensation, no/valid/omitted/multi-mailbox cases |
| API | `tests/unit/app/api/messages/[messageId]/attachments/route.test.ts` | status/error contract and isolation |
| API | `tests/unit/app/api/attachments/[id]/route.test.ts` | inline allowlist, forced download, CSP, nosniff |
| Migration | `tests/unit/db/inbound-attachment-migration.test.ts` | defaults and executable migration/schema parity |
| Browser | `tests/e2e/inbound-attachments.spec.ts` | file list/preview and omission warning |

`npm run verify`, relevant Chromium tests, OpenNext build, and Wrangler dry run
must pass before production rollout.

Production validation uses controlled inbound messages containing a small text
file, an image or PDF, and exact known bytes. Verify D1 metadata, R2 byte hash,
authenticated list/download, safe headers, and visible UI without recording
message content or private recipient data in committed documentation.

## 12. Decisions

- Preserve arbitrary received file types for explicit download rather than
  applying outbound provider-portability restrictions. — 2026-07-24
- Omit an entire abusive attachment set truthfully instead of silently storing a
  partial subset or retrying a deterministic policy failure forever. — 2026-07-24
- Copy attachments per delivered mailbox so authorization and future deletion
  never require cross-tenant shared-object reference counting. — 2026-07-24
- Keep CID body rendering out of scope because the current sanitizer deliberately
  removes all images, and authenticated CID rewriting needs a separate contract.
  — 2026-07-24

## 13. Bug / Change Log

### 2026-07-24 — Specify inbound MIME attachment ingestion

Type: `Feature | Security Fix`

Summary:

- Defined bounded, atomic, mailbox-owned received-file persistence and safe
  rendering/download behavior.

Reason:

- Received attachment parts were discarded after parsing, leaving the existing
  attachment UI nonfunctional for ordinary inbound mail.

Impact:

- Normal received files become visible and downloadable; pathological sets are
  explicitly reported rather than partially or silently lost.

Tests:

- Planned parser, ingestion, API, migration, browser, build, and production
  exact-byte validation.

Notes:

- Coordinates with completed outbound attachment contract F55 and remediation
  item R-24.

### 2026-07-24 — Implement and locally verify inbound attachment ingestion

Type: `Feature | Security Fix`

Summary:

- Added exact-byte MIME parsing, bounded mailbox-owned R2 persistence, atomic
  D1 metadata, compensation, omission reporting, safe previews, and hardened
  authenticated downloads.

Verification:

- `npm run verify`: 1,222 application tests at 100% coverage plus 16 bridge
  tests.
- Playwright: both F57 Chromium scenarios passed. The full suite passed 37/40;
  one unrelated navigation failure passed serially, while two F51 navigation
  tests remain blocked by the existing Next-dev Cloudflare-context harness
  (`ERR_ABORTED` redirect and `getCloudflareContext` initialization).
- Next production build, OpenNext Cloudflare build, and Wrangler dry run pass.

Deployment:

- Migration `0014` applied to production D1.
- Worker `fed65823-9355-44ba-889d-a0f6b28aec59` deployed to
  `mail.henriksen.dev`; Wrangler reports no pending migrations and the
  unauthenticated attachment-list API fails closed with HTTP 401.
- Controlled inbound message `msg_CFVdyWb9uieTffTFtcbe6` stored three
  independent attachment rows and mailbox-owned keys with status `stored`, no
  error, and expected metadata: 90-byte text, 56,400-byte PDF, and 68,249-byte
  JPEG. The production UI listed all three, loaded the PDF iframe, and rendered
  the complete 824×1464 JPEG. The operator downloaded the text attachment and
  confirmed its contents were unchanged.

### 2026-07-24 — Complete production attachment validation

Type: `Production Validation`

Summary:

- Applied migration `0014`, deployed Worker
  `fed65823-9355-44ba-889d-a0f6b28aec59`, received a controlled message with
  text/PDF/JPEG attachments, and verified D1 metadata, mailbox-owned R2 keys,
  production listing, PDF/JPEG previews, and unchanged downloaded text content.

Outcome:

- F57 and remediation item R-24 are `Shipped`.
